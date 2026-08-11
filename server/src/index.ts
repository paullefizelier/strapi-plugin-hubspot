import type { Core } from "@strapi/strapi";
import { runAudit } from "./audit";
import { loadSchema, resolveObjects } from "./properties";
import { publicSettings, resolveApiKey, setStoredSettings } from "./settings";
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

const config = {
  default: {
    apiKey: "",
    // Objects whose properties are offered. Names from the standard set, or
    // `{ name, path }` for a custom object type.
    objects: ["contact", "company"] as unknown[],
    validate: [] as ValidateTarget[],
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
      adminRoute("GET", "/settings", "settings.get", [SETTINGS_ACTION]),
      adminRoute("PUT", "/settings", "settings.update", [SETTINGS_ACTION]),
      adminRoute("DELETE", "/settings", "settings.reset", [SETTINGS_ACTION]),
    ],
  },
};

export default {
  config,
  controllers,
  routes,

  register({ strapi }: { strapi: Core.Strapi }) {
    // Backed by a plain string: existing hand-typed values stay valid, and
    // uninstalling the plugin leaves readable data behind.
    strapi.customFields.register({
      name: "property",
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
    ]);

    const targets = strapi.plugin("hubspot").config("validate", []) as ValidateTarget[];
    for (const target of targets) {
      strapi.documents.use(makeValidationMiddleware(strapi, target));
    }
  },
};
