import type { Core } from "@strapi/strapi";

/**
 * The portal's property schema, fetched once and cached.
 *
 * HubSpot rejects an upsert as a whole when ANY property is unknown — so a
 * single typo doesn't lose one answer, it loses the entire submission. Knowing
 * the real schema lets editors pick from a list instead of typing, and lets the
 * server refuse a bad mapping at save time rather than at send time.
 *
 * Object names are returned raw (`contact`, `deal`…). Labels belong to the admin
 * UI, which translates them — the server stays language-agnostic.
 */

const HS_BASE = "https://api.hubapi.com";
const TTL_MS = 10 * 60 * 1000;

export interface HsObjectDef {
  /** Value stored in the entry's object field, e.g. `contact`. */
  name: string;
  /** HubSpot's URL segment for that object, e.g. `contacts`. */
  path: string;
}

/** Objects HubSpot ships with; anything else is declared in the plugin config. */
export const STANDARD_OBJECTS: HsObjectDef[] = [
  { name: "contact", path: "contacts" },
  { name: "company", path: "companies" },
  { name: "deal", path: "deals" },
  { name: "ticket", path: "tickets" },
  { name: "product", path: "products" },
  { name: "line_item", path: "line_items" },
  { name: "quote", path: "quotes" },
];

export interface HsPropertyOption {
  value: string;
  /** Human label, when HubSpot has one — used when importing options into Strapi. */
  label?: string;
}

export interface HsProperty {
  name: string;
  label: string;
  /** Object this property belongs to (`HsObjectDef.name`). */
  object: string;
  type?: string;
  /** Allowed values, for enumeration properties. */
  options: HsPropertyOption[];
  /** HubSpot's own grouping (display label), shown to help editors locate a property. */
  group?: string;
}

export interface Schema {
  properties: HsProperty[];
  /** Objects actually readable with the current token. */
  objects: string[];
  /** Objects that were configured but refused — almost always a missing scope. */
  unavailable: { object: string; reason: string }[];
  /** Enables deep links into the CRM; derived from the token, never configured. */
  portalId?: number;
  /**
   * Region-specific UI host for this portal (`app-eu1.hubspot.com`…). The REST
   * API is global — `api.hubapi.com` routes by token — but the web app is not,
   * so a link built on `app.hubspot.com` lands on the wrong host for any portal
   * hosted outside NA.
   */
  uiDomain?: string;
}

interface RawProperty {
  name: string;
  label?: string;
  type?: string;
  groupName?: string;
  options?: { value: string; label?: string }[];
  modificationMetadata?: { readOnlyValue?: boolean };
}

let cache: { at: number; schema: Schema } | null = null;
let inFlight: Promise<Schema> | null = null;

async function hsGet<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${HS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw Object.assign(new Error(body.message || `HubSpot ${res.status}`), {
      status: res.status,
    });
  }
  return (await res.json()) as T;
}

/**
 * Group display labels for an object. The property payload only carries the raw
 * group *name* (`contactinformation`); the labels live on their own endpoint.
 * Failing to read them is cosmetic, so it degrades to the raw names.
 */
async function fetchGroups(apiKey: string, path: string): Promise<Record<string, string>> {
  try {
    const res = await hsGet<{ results?: { name: string; label?: string }[] }>(
      apiKey,
      `/crm/v3/properties/${path}/groups`,
    );
    return Object.fromEntries((res.results ?? []).map((g) => [g.name, g.label || g.name]));
  } catch {
    return {};
  }
}

async function fetchObject(apiKey: string, object: HsObjectDef): Promise<HsProperty[]> {
  const [res, groups] = await Promise.all([
    hsGet<{ results?: RawProperty[] }>(apiKey, `/crm/v3/properties/${object.path}`),
    fetchGroups(apiKey, object.path),
  ]);
  return (res.results ?? [])
    // Read-only properties are computed by HubSpot; writing them always fails,
    // so offering them in the picker would only invite mistakes.
    .filter((p) => !p.modificationMetadata?.readOnlyValue)
    .map((p) => ({
      name: p.name,
      label: p.label || p.name,
      object: object.name,
      type: p.type,
      options: (p.options ?? []).map((o) => ({ value: o.value, label: o.label })),
      group: p.groupName ? (groups[p.groupName] ?? p.groupName) : undefined,
    }));
}

/** Portal identity behind the token — used for deep links, never for auth. */
async function fetchAccount(
  apiKey: string,
): Promise<{ portalId?: number; uiDomain?: string }> {
  try {
    return await hsGet<{ portalId?: number; uiDomain?: string }>(
      apiKey,
      "/account-info/v3/details",
    );
  } catch {
    // A token without `oauth` scope can still read properties; deep links are
    // simply omitted rather than the whole schema failing.
    return {};
  }
}

/**
 * Writable properties of every configured object, cached and de-duplicated
 * across concurrent calls.
 *
 * An object the token can't read (missing scope) is reported in `unavailable`
 * instead of failing the whole call: a portal that only granted contact scopes
 * must still get a working contact picker.
 */
export async function loadSchema(
  strapi: Core.Strapi,
  apiKey: string,
  objects: HsObjectDef[],
  { force = false }: { force?: boolean } = {},
): Promise<Schema> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.schema;
  if (!force && inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const settled = await Promise.all(
        objects.map(async (object) => {
          try {
            return { object, properties: await fetchObject(apiKey, object) };
          } catch (err) {
            return { object, error: (err as Error).message };
          }
        }),
      );

      const properties: HsProperty[] = [];
      const available: string[] = [];
      const unavailable: Schema["unavailable"] = [];

      for (const entry of settled) {
        if ("error" in entry && entry.error) {
          unavailable.push({ object: entry.object.name, reason: entry.error });
          strapi.log.warn(`[hubspot] ${entry.object.name} unreadable — ${entry.error}`);
          continue;
        }
        available.push(entry.object.name);
        properties.push(...(entry.properties ?? []));
      }

      if (!available.length) {
        throw new Error(unavailable[0]?.reason ?? "No readable object");
      }

      properties.sort(
        (a, b) => a.object.localeCompare(b.object) || a.label.localeCompare(b.label),
      );

      const account = await fetchAccount(apiKey);
      const schema: Schema = {
        properties,
        objects: available,
        unavailable,
        portalId: account.portalId,
        uiDomain: account.uiDomain,
      };
      cache = { at: Date.now(), schema };
      return schema;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop the cache — used after the API key or the object list changes. */
export function clearCache(): void {
  cache = null;
}

/** A mapping the portal would reject, and why. */
export type Problem =
  | { code: "unknown"; property: string; object: string }
  | { code: "wrong-object"; property: string; object: string; actualObject: string }
  | { code: "whitespace"; property: string; object: string }
  | { code: "bad-option"; property: string; object: string; values: string[] };

export interface Mapping {
  object: string;
  property: string;
  /** Values the field can submit — checked against enumeration properties. */
  values?: string[];
}

/**
 * Why a mapping can't be written, or `null` when it's fine.
 *
 * Returns a structured code rather than a sentence: the message is rendered by
 * the caller, so the wording stays in one place and stays translatable. The
 * codes are also carried in the ValidationError details, for anyone localizing.
 */
export function checkMapping(properties: HsProperty[], mapping: Mapping): Problem | null {
  const { object, property } = mapping;
  const trimmed = property.trim();
  if (!trimmed) return null;

  const match = properties.find((p) => p.object === object && p.name === trimmed);

  if (!match) {
    const elsewhere = properties.find((p) => p.name === trimmed);
    return elsewhere
      ? { code: "wrong-object", property: trimmed, object, actualObject: elsewhere.object }
      : { code: "unknown", property: trimmed, object };
  }

  // A trailing space reaches HubSpot verbatim and is rejected like any unknown
  // property — invisible in a text field, so worth naming explicitly.
  if (trimmed !== property) return { code: "whitespace", property, object };

  // An enumeration refuses a value outside its list just as hard as it refuses
  // an unknown property, so a select whose options drifted is the same failure.
  if (match.type === "enumeration" && match.options.length && mapping.values?.length) {
    const allowed = match.options.map((o) => o.value);
    const stray = mapping.values.filter((v) => v && !allowed.includes(v));
    if (stray.length) {
      return { code: "bad-option", property: trimmed, object, values: stray };
    }
  }

  return null;
}

/** English rendering of a problem — the package's language. */
export function describeProblem(problem: Problem): string {
  switch (problem.code) {
    case "unknown":
      return `"${problem.property}" does not exist on ${problem.object} in this HubSpot portal`;
    case "wrong-object":
      return `"${problem.property}" exists on ${problem.actualObject}, not on ${problem.object}`;
    case "whitespace":
      return `"${problem.property}" has surrounding whitespace`;
    case "bad-option":
      return `"${problem.property}" does not accept ${problem.values
        .map((v) => `"${v}"`)
        .join(", ")}`;
  }
}

/** Resolve the configured object list, accepting names or full definitions. */
export function resolveObjects(configured: unknown): HsObjectDef[] {
  if (!Array.isArray(configured) || !configured.length) {
    return STANDARD_OBJECTS.filter((o) => o.name === "contact" || o.name === "company");
  }
  const out: HsObjectDef[] = [];
  for (const entry of configured) {
    if (typeof entry === "string") {
      const known = STANDARD_OBJECTS.find((o) => o.name === entry || o.path === entry);
      // An unknown string is assumed to be a custom object type id, which HubSpot
      // accepts directly as the URL segment.
      out.push(known ?? { name: entry, path: entry });
    } else if (entry && typeof entry === "object" && "name" in entry) {
      const e = entry as { name: string; path?: string };
      out.push({ name: e.name, path: e.path || e.name });
    }
  }
  return out;
}
