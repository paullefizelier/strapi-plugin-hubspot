import type { Core } from "@strapi/strapi";
import { runAudit } from "./audit";
import { searchCompanies } from "./company";
import contentTypes from "./content-types";
import {
  createFormsService,
  publicForm,
  sanitizeRawValues,
  SUBMISSION_UID,
  type FormEntry,
  type SubmitMeta,
} from "./forms";
import { createFormsAdminController, FORM_UID } from "./formsAdmin";
import { loadSchema, resolveObjects } from "./properties";
import { createLimiter } from "./rateLimit";
import { publicSettings, resolveApiKey, setStoredSettings } from "./settings";
import { fieldOrder, submissionsCsv, type SubmissionRow } from "./submissions";
import { createSubmitService, FAILURE_UID } from "./submit";
import { makeValidationMiddleware, type ValidateTarget } from "./validation";

/**
 * Plugin configuration (config/plugins.ts of the host app):
 *
 * hubspot: {
 *   enabled: true,
 *   config: {
 *     apiKey: env("HUBSPOT_API_KEY"),   // optional — can be set from the admin UI
 *     validate: [                       // optional — entries whose mappings are checked on save
 *       { uid: "api::form.form", objectField: "hsObject", propertyField: "hsProperty" },
 *     ],
 *   },
 * }
 *
 * The API key set from the admin UI takes precedence over both.
 */

/** RBAC action gating the settings screen and its routes. */
const SETTINGS_ACTION = "plugin::hubspot.settings";
/** RBAC action gating the form builder and its routes. */
const FORMS_ACTION = "plugin::hubspot.forms";

const config = {
  default: {
    apiKey: "",
    // Objects whose properties are offered. Names from the standard set, or
    // `{ name, path }` for a custom object type.
    objects: ["contact", "company"] as unknown[],
    validate: [] as ValidateTarget[],
    // Submission pipeline of the built forms. Both default to true:
    //  - companyFromDomain: a corporate email upserts the Company (deduped by
    //    domain) and associates it to the contact;
    //  - timelineNote: a note recaps the submission on the contact's timeline.
    forms: {
      companyFromDomain: true,
      timelineNote: true,
      // Per-IP brakes on the public routes; 0 disables one.
      rateLimit: { submitPerMinute: 6, searchPerMinute: 30 },
    },
  },
  validator(cfg: { validate?: unknown }) {
    if (cfg.validate && !Array.isArray(cfg.validate)) {
      throw new Error("hubspot: `validate` must be an array of { uid, objectField, propertyField }");
    }
  },
};

const controllers = {
  properties: ({ strapi }: { strapi: Core.Strapi }) => ({
    async list(ctx: { query: { refresh?: string }; body: unknown; throw: (s: number, m: string) => never }) {
      const { apiKey } = await resolveApiKey(strapi);
      if (!apiKey) {
        // Not an error: a fresh install simply has no key yet, and the field
        // must degrade to free text rather than block the editor.
        ctx.body = { configured: false, properties: [], objects: [], unavailable: [] };
        return;
      }
      try {
        const schema = await loadSchema(
          strapi,
          apiKey,
          resolveObjects(strapi.plugin("hubspot").config("objects", [])),
          { force: ctx.query.refresh === "1" },
        );
        ctx.body = { configured: true, ...schema };
      } catch (err) {
        strapi.log.error(`[hubspot] ${(err as Error).message}`);
        ctx.throw(502, "Cannot reach HubSpot — check the API key.");
      }
    },
  }),

  audit: ({ strapi }: { strapi: Core.Strapi }) => ({
    async run(ctx: { body: unknown; throw: (s: number, m: string) => never }) {
      const { apiKey } = await resolveApiKey(strapi);
      if (!apiKey) {
        ctx.body = { configured: false, targets: [] };
        return;
      }
      const targets = strapi.plugin("hubspot").config("validate", []) as ValidateTarget[];
      try {
        // Forced refresh: an audit reports the portal as it is now, not as the
        // cache remembers it — a property deleted five minutes ago must show.
        const schema = await loadSchema(
          strapi,
          apiKey,
          resolveObjects(strapi.plugin("hubspot").config("objects", [])),
          { force: true },
        );
        ctx.body = { configured: true, targets: await runAudit(strapi, targets, schema) };
      } catch (err) {
        strapi.log.error(`[hubspot] audit failed — ${(err as Error).message}`);
        ctx.throw(502, "Cannot reach HubSpot — check the API key.");
      }
    },
  }),

  failures: ({ strapi }: { strapi: Core.Strapi }) => ({
    async list(ctx: { body: unknown }) {
      const total = (await strapi
        .documents(FAILURE_UID as never)
        .count({} as never)) as unknown as number;
      ctx.body = { total };
    },
    async retry(ctx: { body: unknown }) {
      ctx.body = await strapi.plugin("hubspot").service("submit").retryFailures();
    },
  }),

  formsAdmin: ({ strapi }: { strapi: Core.Strapi }) => createFormsAdminController(strapi),

  company: ({ strapi }: { strapi: Core.Strapi }) => {
    const limits = strapi
      .plugin("hubspot")
      .config("forms", {}) as { rateLimit?: { searchPerMinute?: number } };
    const limiter = createLimiter({
      windowMs: 60_000,
      max: limits.rateLimit?.searchPerMinute ?? 30,
    });
    return {
      /** SIRENE autocomplete for the company field — bounded, cached upstream. */
      async search(ctx: {
        query: { q?: string };
        request: { ip?: string };
        body: unknown;
        throw: (s: number, m: string) => never;
      }) {
        if (!limiter.allow(ctx.request.ip ?? "unknown")) {
          ctx.throw(429, "Too many searches — slow down.");
        }
        const q = typeof ctx.query.q === "string" ? ctx.query.q : "";
        ctx.body = { companies: await searchCompanies(q) };
      },
    };
  },

  submissions: ({ strapi }: { strapi: Core.Strapi }) => ({
    /** Paged submissions, newest first, optionally narrowed to one form. */
    async list(ctx: {
      query: { form?: string; page?: string; pageSize?: string };
      body: unknown;
    }) {
      const filters = ctx.query.form ? { form: ctx.query.form } : undefined;
      const page = Math.max(1, Number(ctx.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize) || 20));
      const [rows, total] = await Promise.all([
        strapi.documents(SUBMISSION_UID as never).findMany({
          filters,
          sort: "createdAt:desc",
          limit: pageSize,
          start: (page - 1) * pageSize,
        } as never) as unknown as Promise<SubmissionRow[]>,
        strapi.documents(SUBMISSION_UID as never).count({ filters } as never) as unknown as Promise<number>,
      ]);
      ctx.body = { submissions: rows, total, page, pageSize };
    },

    /**
     * Whole history of one form as CSV, definition columns first. Returned as
     * JSON (`{ csv, filename }`): the admin fetch client speaks JSON, and the
     * page turns it into a download — no auth-header gymnastics.
     */
    async export(ctx: {
      query: { form?: string };
      body: unknown;
      throw: (s: number, m: string) => never;
    }) {
      const slug = ctx.query.form;
      if (!slug) ctx.throw(400, "form is required");
      const [rows, entry] = await Promise.all([
        strapi.documents(SUBMISSION_UID as never).findMany({
          filters: { form: slug },
          sort: "createdAt:desc",
          limit: 10000,
        } as never) as unknown as Promise<SubmissionRow[]>,
        strapi.documents(FORM_UID as never).findFirst({
          filters: { slug },
          status: "draft",
        } as never) as unknown as Promise<FormEntry | null>,
      ]);
      ctx.body = {
        csv: submissionsCsv(rows, fieldOrder(entry?.definition)),
        filename: `${slug}-submissions-${new Date().toISOString().slice(0, 10)}.csv`,
        total: rows.length,
      };
    },
  }),

  forms: ({ strapi }: { strapi: Core.Strapi }) => {
    const limits = strapi
      .plugin("hubspot")
      .config("forms", {}) as { rateLimit?: { submitPerMinute?: number } };
    const submitLimiter = createLimiter({
      windowMs: 60_000,
      max: limits.rateLimit?.submitPerMinute ?? 6,
    });
    return {
    /** Published form for the host frontend — CRM mapping stripped. */
    async findOne(ctx: {
      params: { slug: string };
      query: { locale?: string };
      body: unknown;
      throw: (s: number, m: string) => never;
    }) {
      const entry = (await strapi.documents(FORM_UID as never).findFirst({
        filters: { slug: ctx.params.slug },
        status: "published",
        locale: ctx.query.locale,
      } as never)) as unknown as FormEntry | null;
      if (!entry?.definition) ctx.throw(404, "Form not found");
      ctx.body = publicForm(entry);
    },

    async submit(ctx: {
      params: { slug: string };
      query: { locale?: string };
      request: { body?: { values?: unknown; meta?: Record<string, unknown> } };
      body: unknown;
      throw: (s: number, m: string) => never;
    }) {
      const entry = (await strapi.documents(FORM_UID as never).findFirst({
        filters: { slug: ctx.params.slug },
        status: "published",
        locale: ctx.query.locale,
      } as never)) as unknown as FormEntry | null;
      if (!entry?.definition) ctx.throw(404, "Form not found");

      if (!submitLimiter.allow((ctx as unknown as { request: { ip?: string } }).request.ip ?? "unknown")) {
        ctx.throw(429, "Too many submissions — try again in a minute.");
      }
      const values = sanitizeRawValues(ctx.request.body?.values);
      if (!values || !Object.keys(values).length) ctx.throw(422, "Invalid submission");

      // Meta is display-only (stored + timeline note): strings, clipped.
      const rawMeta = ctx.request.body?.meta ?? {};
      const meta: SubmitMeta = {};
      for (const key of ["pagePath", "pageUrl", "originPath", "originLabel", "source"]) {
        const v = rawMeta[key];
        if (typeof v === "string" && v) meta[key] = v.slice(0, 500);
      }

      const outcome = await strapi.plugin("hubspot").service("forms").submit(entry, values, meta);
      if (!outcome.ok) {
        (ctx as unknown as { status: number }).status = 422;
        ctx.body = { ok: false, missingRequired: outcome.missingRequired ?? [] };
        return;
      }
      ctx.body = { ok: true, hubspotSynced: outcome.hubspotSynced };
    },
    };
  },

  settings: ({ strapi }: { strapi: Core.Strapi }) => ({
    async get(ctx: { body: unknown }) {
      ctx.body = await publicSettings(strapi);
    },
    async update(ctx: { request: { body: { apiKey?: string } }; body: unknown }) {
      const apiKey = (ctx.request.body?.apiKey ?? "").trim();
      await setStoredSettings(strapi, apiKey ? { apiKey } : null);
      ctx.body = await publicSettings(strapi);
    },
    async reset(ctx: { body: unknown }) {
      await setStoredSettings(strapi, null);
      ctx.body = await publicSettings(strapi);
    },
  }),
};

const adminRoute = (method: string, path: string, handler: string, actions?: string[]) => ({
  method,
  path,
  handler,
  config: {
    policies: [
      "admin::isAuthenticatedAdmin",
      // The token is a portal-wide secret; reading properties is not. Only the
      // settings routes carry the extra permission.
      ...(actions ? [{ name: "admin::hasPermissions", config: { actions } }] : []),
    ],
  },
});

const routes = {
  admin: {
    type: "admin",
    routes: [
      adminRoute("GET", "/properties", "properties.list"),
      adminRoute("GET", "/audit", "audit.run", [SETTINGS_ACTION]),
      adminRoute("GET", "/failures", "failures.list", [SETTINGS_ACTION]),
      adminRoute("POST", "/failures/retry", "failures.retry", [SETTINGS_ACTION]),
      adminRoute("GET", "/settings", "settings.get", [SETTINGS_ACTION]),
      adminRoute("PUT", "/settings", "settings.update", [SETTINGS_ACTION]),
      adminRoute("DELETE", "/settings", "settings.reset", [SETTINGS_ACTION]),
      adminRoute("GET", "/builder/forms", "formsAdmin.list", [FORMS_ACTION]),
      adminRoute("POST", "/builder/forms", "formsAdmin.create", [FORMS_ACTION]),
      adminRoute("GET", "/builder/forms/:documentId", "formsAdmin.findOne", [FORMS_ACTION]),
      adminRoute("PUT", "/builder/forms/:documentId", "formsAdmin.update", [FORMS_ACTION]),
      adminRoute("POST", "/builder/forms/:documentId/publish", "formsAdmin.publish", [FORMS_ACTION]),
      adminRoute("POST", "/builder/forms/:documentId/unpublish", "formsAdmin.unpublish", [FORMS_ACTION]),
      adminRoute("DELETE", "/builder/forms/:documentId", "formsAdmin.remove", [FORMS_ACTION]),
      adminRoute("POST", "/builder/forms/:documentId/duplicate", "formsAdmin.duplicate", [FORMS_ACTION]),
      // No FORMS_ACTION: editors pick forms from the Content Manager, like
      // they pick properties — the builder itself stays gated.
      adminRoute("GET", "/forms-options", "formsAdmin.options"),
      adminRoute("GET", "/builder/import/sources", "formsAdmin.listSources", [FORMS_ACTION]),
      adminRoute("POST", "/builder/import", "formsAdmin.runImport", [FORMS_ACTION]),
      adminRoute("GET", "/builder/import/hubspot", "formsAdmin.listHubspotSources", [FORMS_ACTION]),
      adminRoute("POST", "/builder/import/hubspot", "formsAdmin.runHubspotImport", [FORMS_ACTION]),
      adminRoute("GET", "/builder/submissions", "submissions.list", [FORMS_ACTION]),
      adminRoute("GET", "/builder/submissions/export", "submissions.export", [FORMS_ACTION]),
    ],
  },
  // Public form delivery + submission, under /api/hubspot/…. Like any
  // content-api route, they must be granted to the Public role in
  // Settings → Users & Permissions before the frontend can call them.
  "content-api": {
    type: "content-api",
    routes: [
      { method: "GET", path: "/forms/:slug", handler: "forms.findOne", config: { policies: [] } },
      { method: "GET", path: "/company-search", handler: "company.search", config: { policies: [] } },
      { method: "POST", path: "/forms/:slug/submit", handler: "forms.submit", config: { policies: [] } },
    ],
  },
};

export default {
  config,
  contentTypes,
  controllers,
  routes,

  services: {
    submit: ({ strapi }: { strapi: Core.Strapi }) => createSubmitService(strapi),
    forms: ({ strapi }: { strapi: Core.Strapi }) => createFormsService(strapi),
  },

  register({ strapi }: { strapi: Core.Strapi }) {
    // Backed by plain strings: existing hand-typed values stay valid, and
    // uninstalling the plugin leaves readable data behind.
    strapi.customFields.register({
      name: "property",
      plugin: "hubspot",
      type: "string",
    });
    strapi.customFields.register({
      name: "object",
      plugin: "hubspot",
      type: "string",
    });
    // A form built in the builder, referenced from host content (a hero block,
    // a landing…) by its slug — a plain string, so uninstalling degrades safely.
    strapi.customFields.register({
      name: "form-picker",
      plugin: "hubspot",
      type: "string",
    });
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await strapi.service("admin::permission").actionProvider.registerMany([
      {
        section: "plugins",
        displayName: "Access the HubSpot settings",
        uid: "settings",
        pluginName: "hubspot",
      },
      {
        section: "plugins",
        displayName: "Use the HubSpot form builder",
        uid: "forms",
        pluginName: "hubspot",
      },
    ]);

    const targets = strapi.plugin("hubspot").config("validate", []) as ValidateTarget[];
    for (const target of targets) {
      strapi.documents.use(makeValidationMiddleware(strapi, target));
    }
  },
};
