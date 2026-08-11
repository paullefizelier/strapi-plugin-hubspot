import type { Core } from "@strapi/strapi";
import { errors } from "@strapi/utils";
import {
  checkMapping,
  describeProblem,
  loadSchema,
  resolveObjects,
  type Mapping,
} from "./properties";
import { publicSettings, resolveApiKey, setStoredSettings } from "./settings";

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

interface ValidateTarget {
  uid: string;
  objectField: string;
  propertyField: string;
  /**
   * Repeatable holding the values a field can submit (default `options`), each
   * `{ value?, label? }`. Checked against enumeration properties: a select whose
   * choices drifted from HubSpot fails exactly like an unknown property.
   */
  optionsField?: string;
}

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

const adminRoute = (method: string, path: string, handler: string) => ({
  method,
  path,
  handler,
  config: { policies: ["admin::isAuthenticatedAdmin"] },
});

const routes = {
  admin: {
    type: "admin",
    routes: [
      adminRoute("GET", "/properties", "properties.list"),
      adminRoute("GET", "/settings", "settings.get"),
      adminRoute("PUT", "/settings", "settings.update"),
      adminRoute("DELETE", "/settings", "settings.reset"),
    ],
  },
};

/** Every `{ object, property }` pair found anywhere in an entry, at any depth. */
function collectMappings(
  node: unknown,
  target: ValidateTarget,
  found: Mapping[] = [],
): Mapping[] {
  if (Array.isArray(node)) {
    for (const item of node) collectMappings(item, target, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;

  const obj = node as Record<string, unknown>;
  const property = obj[target.propertyField];
  if (typeof property === "string" && property.trim()) {
    const object = obj[target.objectField];
    const rawOptions = obj[target.optionsField || "options"];
    const values = Array.isArray(rawOptions)
      ? rawOptions
          .map((o) => {
            const opt = (o ?? {}) as { value?: unknown; label?: unknown };
            const v = typeof opt.value === "string" && opt.value.trim() ? opt.value : opt.label;
            return typeof v === "string" ? v.trim() : "";
          })
          .filter(Boolean)
      : undefined;
    found.push({
      object: typeof object === "string" && object ? object : "contact",
      property,
      values,
    });
  }
  for (const value of Object.values(obj)) collectMappings(value, target, found);
  return found;
}

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

  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const targets = strapi.plugin("hubspot").config("validate", []) as ValidateTarget[];
    if (!targets.length) return;

    for (const target of targets) {
      strapi.documents.use(async (context, next) => {
        const isWrite = ["create", "update"].includes(context.action);
        if (!isWrite || context.uid !== target.uid) return next();

        const mappings = collectMappings((context.params as { data?: unknown })?.data, target);
        if (!mappings.length) return next();

        const { apiKey } = await resolveApiKey(strapi);
        if (!apiKey) return next(); // Nothing to validate against — never block.

        let schema;
        try {
          schema = await loadSchema(
            strapi,
            apiKey,
            resolveObjects(strapi.plugin("hubspot").config("objects", [])),
          );
        } catch {
          // HubSpot unreachable: saving content must not depend on their uptime.
          strapi.log.warn("[hubspot] schema unavailable — validation skipped");
          return next();
        }

        const problems = mappings
          .map((m) => checkMapping(schema.properties, m))
          .filter((p): p is NonNullable<typeof p> => Boolean(p));

        if (problems.length) {
          // A ValidationError surfaces as a readable message in the Content
          // Manager; a plain Error would show an opaque 500 instead. The
          // structured problems ride along in `details` so a host app can
          // localize them without parsing the sentence.
          const sentences = [...new Set(problems.map(describeProblem))];
          throw new errors.ValidationError(
            `Invalid HubSpot mapping — ${sentences.join("; ")}`,
            { problems },
          );
        }
        return next();
      });
    }
  },
};
