/**
 * The company field's data source: the French government's open
 * "Recherche d'entreprises" API (recherche-entreprises.api.gouv.fr — INSEE
 * SIRENE data, no key, ~7 req/s per IP). Two uses:
 *
 *  - autocomplete: `searchCompanies(q)` behind the public route, TTL-cached;
 *  - authority at submission: `resolveSiret(siret)` re-reads the SIRENE
 *    record server-side — the browser only ever nominates a SIRET, never the
 *    data that reaches the CRM.
 */

import type { Primitive } from "./conditions";

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SIRET_RE = /^\d{14}$/;

export type CompanyDatum =
  | "name"
  | "siret"
  | "siren"
  | "address"
  | "zip"
  | "city"
  | "headquarters"
  | "naf"
  | "nafLabel"
  | "headcount";

export type CompanyMap = Partial<Record<CompanyDatum, { object?: string; property?: string }>>;

export interface CompanyHit {
  siret: string;
  siren: string;
  name: string;
  address?: string;
  zip?: string;
  city?: string;
  headquarters: boolean;
  naf?: string;
  nafLabel?: string;
  headcount?: string;
  closed?: boolean;
}

/** The slice of the API answer this module reads — everything else ignored. */
interface ApiEtablissement {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  est_siege?: boolean;
  etat_administratif?: string;
  activite_principale?: string;
  tranche_effectif_salarie?: string;
}

interface ApiResult {
  nom_complet?: string;
  nom_raison_sociale?: string;
  siren?: string;
  etat_administratif?: string;
  activite_principale?: string;
  tranche_effectif_salarie?: string;
  siege?: ApiEtablissement;
  matching_etablissements?: ApiEtablissement[];
}

export interface SearchPayload {
  results?: ApiResult[];
}

import { NAF_LABELS } from "./data/naf";

export function nafLabelOf(code?: string): string | undefined {
  return code ? NAF_LABELS[code] : undefined;
}

/** INSEE `tranche_effectif_salarie` codes (NN / absent = not reported). */
const HEADCOUNT_LABELS: Record<string, string> = {
  "00": "0 salarié",
  "01": "1 ou 2 salariés",
  "02": "3 à 5 salariés",
  "03": "6 à 9 salariés",
  "11": "10 à 19 salariés",
  "12": "20 à 49 salariés",
  "21": "50 à 99 salariés",
  "22": "100 à 199 salariés",
  "31": "200 à 249 salariés",
  "32": "250 à 499 salariés",
  "41": "500 à 999 salariés",
  "42": "1 000 à 1 999 salariés",
  "51": "2 000 à 4 999 salariés",
  "52": "5 000 à 9 999 salariés",
  "53": "10 000 salariés et plus",
};

export function headcountLabelOf(code?: string): string | undefined {
  return code ? HEADCOUNT_LABELS[code] : undefined;
}

function toHit(result: ApiResult, etab: ApiEtablissement): CompanyHit | null {
  if (!etab.siret || !result.siren) return null;
  return {
    siret: etab.siret,
    siren: result.siren,
    name: result.nom_raison_sociale || result.nom_complet || "",
    address: etab.adresse,
    zip: etab.code_postal,
    city: etab.libelle_commune,
    headquarters: Boolean(etab.est_siege),
    naf: etab.activite_principale || result.activite_principale,
    nafLabel: nafLabelOf(etab.activite_principale || result.activite_principale),
    headcount:
      headcountLabelOf(etab.tranche_effectif_salarie) ??
      headcountLabelOf(result.tranche_effectif_salarie),
    closed: etab.etat_administratif === "F" || undefined,
  };
}

/**
 * One entreprise → one hit per relevant établissement: the siège first, then
 * the établissements the query matched — deduped (the siège often appears in
 * both lists) and, for search results, stripped of closed ones.
 */
export function normalizeCompanyHits(payload: SearchPayload): CompanyHit[] {
  const hits: CompanyHit[] = [];
  const seen = new Set<string>();
  for (const result of payload.results ?? []) {
    const etablissements = [result.siege, ...(result.matching_etablissements ?? [])];
    for (const etab of etablissements) {
      if (!etab?.siret || seen.has(etab.siret)) continue;
      const hit = toHit(result, etab);
      if (!hit || hit.closed) continue;
      seen.add(hit.siret);
      hits.push(hit);
    }
  }
  return hits;
}

/**
 * The exact établissement a SIRET designates in a payload — closed ones
 * included: at resolution time the visitor already chose it, and hiding the
 * data would only make the lead poorer.
 */
export function pickSiret(payload: SearchPayload, siret: string): CompanyHit | null {
  for (const result of payload.results ?? []) {
    const etablissements = [result.siege, ...(result.matching_etablissements ?? [])];
    for (const etab of etablissements) {
      if (etab?.siret === siret) return toHit(result, etab);
    }
  }
  return null;
}

/**
 * The resolved record → one property bag per CRM object, honoring the field's
 * `companyMap`. Only complete mappings with an actual value produce a write.
 */
export function companyProperties(
  map: CompanyMap,
  hit: CompanyHit,
): Record<string, Record<string, Primitive>> {
  const groups: Record<string, Record<string, Primitive>> = {};
  for (const [datum, mapping] of Object.entries(map) as [
    CompanyDatum,
    { object?: string; property?: string } | undefined,
  ][]) {
    const property = mapping?.property?.trim();
    if (!property) continue;
    const value = hit[datum];
    if (value === undefined || value === "") continue;
    const object = mapping?.object?.trim() || "company";
    (groups[object] ??= {})[property] = value as Primitive;
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Fetch layer — TTL cache + timeout; failures return empty rather than throw.

const cache = new Map<string, { at: number; hits: CompanyHit[] }>();

async function query(params: string): Promise<SearchPayload | null> {
  try {
    const res = await fetch(`${API_BASE}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as SearchPayload;
  } catch {
    return null;
  }
}

/**
 * A pasted identifier survives its formatting: "798 841 284 00010" queries as
 * a SIRET, "798.841.284" as a SIREN. Anything else is a plain text query.
 */
export function normalizeQuery(q: string): string {
  const trimmed = q.trim();
  const digits = trimmed.replace(/[\s.-]/g, "");
  return /^\d{9}$/.test(digits) || /^\d{14}$/.test(digits) ? digits : trimmed;
}

/** Autocomplete search. Bounded, cached; empty on any failure. */
export async function searchCompanies(q: string): Promise<CompanyHit[]> {
  const trimmed = normalizeQuery(q).slice(0, 60);
  if (trimmed.length < 3) return [];
  const key = trimmed.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.hits;

  // Closed structures are excluded at the source, and big groups surface more
  // of their établissements than the API's default.
  const payload = await query(
    `q=${encodeURIComponent(trimmed)}&per_page=8&etat_administratif=A&limite_matching_etablissements=5`,
  );
  const hits = payload ? normalizeCompanyHits(payload) : [];
  if (payload) cache.set(key, { at: Date.now(), hits });
  return hits;
}

/** Authoritative re-resolution of a selected SIRET; null when unreachable. */
export async function resolveSiret(siret: string): Promise<CompanyHit | null> {
  if (!SIRET_RE.test(siret)) return null;
  const payload = await query(`q=${encodeURIComponent(siret)}&per_page=1`);
  return payload ? pickSiret(payload, siret) : null;
}

/** Test hook. */
export function clearCompanyCache(): void {
  cache.clear();
}
