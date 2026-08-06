import type { Core } from "@strapi/strapi";

/**
 * The portal's property schema, fetched once and cached.
 *
 * HubSpot rejects an upsert as a whole when ANY property is unknown — so a
 * single typo doesn't lose one answer, it loses the entire submission. Knowing
 * the real schema lets editors pick from a list instead of typing, and lets the
 * server refuse a bad mapping at save time rather than at send time.
 */

const HS_BASE = "https://api.hubapi.com";
const TTL_MS = 10 * 60 * 1000;

export type HsObject = "contact" | "company";

/** HubSpot's plural path segment per object. */
const PLURAL: Record<HsObject, string> = {
  contact: "contacts",
  company: "companies",
};

export interface HsProperty {
  name: string;
  label: string;
  object: HsObject;
  type?: string;
  /** Allowed values, for enumeration properties. */
  options: string[];
  /** HubSpot's own grouping, shown to help editors locate a property. */
  group?: string;
}

interface RawProperty {
  name: string;
  label?: string;
  type?: string;
  groupName?: string;
  options?: { value: string }[];
  modificationMetadata?: { readOnlyValue?: boolean };
}

let cache: { at: number; properties: HsProperty[] } | null = null;
let inFlight: Promise<HsProperty[]> | null = null;

async function fetchObject(apiKey: string, object: HsObject): Promise<HsProperty[]> {
  const res = (await fetch(`${HS_BASE}/crm/v3/properties/${PLURAL[object]}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`HubSpot ${r.status} sur ${PLURAL[object]}`);
    return r.json();
  })) as { results?: RawProperty[] };

  return (res.results ?? [])
    // Read-only properties are computed by HubSpot; writing them always fails,
    // so offering them in the picker would only invite mistakes.
    .filter((p) => !p.modificationMetadata?.readOnlyValue)
    .map((p) => ({
      name: p.name,
      label: p.label || p.name,
      object,
      type: p.type,
      options: (p.options ?? []).map((o) => o.value),
      group: p.groupName,
    }));
}

/** Writable properties of both objects, cached and de-duplicated across calls. */
export async function listProperties(
  strapi: Core.Strapi,
  apiKey: string,
  { force = false }: { force?: boolean } = {},
): Promise<HsProperty[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.properties;
  if (!force && inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const [contact, company] = await Promise.all([
        fetchObject(apiKey, "contact"),
        fetchObject(apiKey, "company"),
      ]);
      const properties = [...contact, ...company].sort(
        (a, b) => a.object.localeCompare(b.object) || a.label.localeCompare(b.label),
      );
      cache = { at: Date.now(), properties };
      return properties;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop the cache — used after the API key changes. */
export function clearCache(): void {
  cache = null;
}

/**
 * Why a property can't be written, or `null` when it's fine. Returning a reason
 * rather than a boolean lets the caller tell an editor what to fix.
 */
export function checkProperty(
  properties: HsProperty[],
  object: HsObject,
  name: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const match = properties.find((p) => p.object === object && p.name === trimmed);
  if (match) return trimmed === name ? null : `« ${name} » contient un espace superflu`;

  const onOther = properties.find((p) => p.object !== object && p.name === trimmed);
  if (onOther) {
    return `« ${trimmed} » existe sur l'objet ${onOther.object === "contact" ? "Contact" : "Société"}, pas sur ${object === "contact" ? "Contact" : "Société"}`;
  }
  return `« ${trimmed} » n'existe pas dans ce portail HubSpot`;
}
