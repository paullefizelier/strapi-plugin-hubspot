import type { Core } from "@strapi/strapi";
import { errors } from "@strapi/utils";
import {
  checkMapping,
  describeProblem,
  loadSchema,
  resolveObjects,
  type Mapping,
  type Problem,
} from "./properties";
import { resolveApiKey } from "./settings";

/** An entry type whose HubSpot mappings are checked before every write. */
export interface ValidateTarget {
  uid: string;
  objectField: string;
  propertyField: string;
  /**
   * Repeatable holding the values a field can submit (default `options`), each
   * `{ value?, label? }`. Checked against enumeration properties: a select whose
   * choices drifted from HubSpot fails exactly like an unknown property.
   */
  optionsField?: string;
  /**
   * When `false`, an `unknown` property is logged and let through instead of
   * blocking the save — the workflow where a property is staged in HubSpot but
   * not created yet. The other codes (`wrong-object`, `whitespace`,
   * `bad-option`) always block: no legitimate workflow produces them.
   * Defaults to `true`.
   */
  strict?: boolean;
}

/** Every `{ object, property }` pair found anywhere in an entry, at any depth. */
export function collectMappings(
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

// Loose on purpose: Strapi's own Context is a union over every action, and a
// delete's params carry no `data` — a narrower type here fails to unify.
interface DocumentContext {
  action: string;
  uid: string;
  params?: unknown;
}

/**
 * The document-service middleware validating one target's mappings on write.
 *
 * Extracted from `bootstrap` so the strict/non-strict behaviour can be tested
 * against a minimal strapi mock instead of a running instance.
 */
export function makeValidationMiddleware(strapi: Core.Strapi, target: ValidateTarget) {
  // `any` mirrors Strapi's Middleware result — the middleware only ever passes
  // `next()`'s value through, whatever the action returned.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (context: DocumentContext, next: () => any): Promise<any> => {
    const isWrite = ["create", "update"].includes(context.action);
    if (!isWrite || context.uid !== target.uid) return next();

    const mappings = collectMappings(
      (context.params as { data?: unknown } | undefined)?.data,
      target,
    );
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
      .filter((p): p is Problem => Boolean(p));

    // `unknown` is the one code a legitimate workflow can produce — a property
    // staged in HubSpot but not created yet. A non-strict target lets it
    // through with a warning; everything else is always a mistake.
    const blocking =
      target.strict === false ? problems.filter((p) => p.code !== "unknown") : problems;
    const soft = problems.filter((p) => !blocking.includes(p));

    if (soft.length) {
      const sentences = [...new Set(soft.map(describeProblem))];
      strapi.log.warn(
        `[hubspot] ${target.uid}: ${sentences.join("; ")} — allowed (strict: false)`,
      );
    }

    if (blocking.length) {
      // A ValidationError surfaces as a readable message in the Content
      // Manager; a plain Error would show an opaque 500 instead. The
      // structured problems ride along in `details` so a host app can
      // localize them without parsing the sentence.
      const sentences = [...new Set(blocking.map(describeProblem))];
      throw new errors.ValidationError(
        `Invalid HubSpot mapping — ${sentences.join("; ")}`,
        { problems: blocking },
      );
    }
    return next();
  };
}
