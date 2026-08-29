/**
 * The form-builder server side: shaping a published form for the public API,
 * and turning a submission into HubSpot upserts.
 *
 * The pipeline mirrors what a B2B lead capture needs: the person is upserted
 * as a Contact (email is the dedup key); when the email is on a corporate
 * domain the company is found-or-created by `domain` and associated to the
 * contact; a timeline note recaps the whole submission for whoever picks the
 * lead up. Company and note are best-effort — the contact is the lead.
 */

import type { Core } from "@strapi/strapi";
import {
  resolveSubmission,
  type FormDefinition,
  type Primitive,
} from "./conditions";
import {
  companyProperties,
  resolveSiret,
  type CompanyHit,
  type CompanyMap,
} from "./company";
import { checkMapping, loadSchema, resolveObjects, type Problem } from "./properties";
import { resolveApiKey } from "./settings";

export interface FormEntry {
  name: string;
  slug: string;
  title?: string | null;
  subtitle?: string | null;
  nextLabel?: string | null;
  submitLabel?: string | null;
  successMessage?: string | null;
  class?: string | null;
  locale?: string | null;
  definition: FormDefinition;
  [key: string]: unknown;
}

export interface PublicForm {
  slug: string;
  title?: string | null;
  subtitle?: string | null;
  nextLabel?: string | null;
  submitLabel?: string | null;
  successMessage?: string | null;
  class?: string | null;
  locale?: string | null;
  steps: FormDefinition["steps"];
}

/** The public shape: rendering meta + structure, minus the CRM mapping. */
export function publicForm(entry: FormEntry): PublicForm {
  return {
    slug: entry.slug,
    title: entry.title ?? null,
    subtitle: entry.subtitle ?? null,
    nextLabel: entry.nextLabel ?? null,
    submitLabel: entry.submitLabel ?? null,
    successMessage: entry.successMessage ?? null,
    class: entry.class ?? null,
    locale: entry.locale ?? null,
    steps: (entry.definition?.steps ?? []).map((step) => ({
      ...step,
      // The CRM mappings are the server's business — never the browser's.
      fields: (step.fields ?? []).map(({ hubspot: _hubspot, companyMap: _companyMap, ...fld }) => fld),
    })),
  };
}

interface HubspotMapping {
  object?: string;
  property?: string;
}

/**
 * Resolved values → one property bag per CRM object. A field with no mapping
 * writes to `contact` under its own name, like the legacy pipeline did.
 */
export function groupByObject(
  definition: FormDefinition,
  values: Record<string, Primitive>,
): Record<string, Record<string, Primitive>> {
  const groups: Record<string, Record<string, Primitive>> = {};
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      // Company fields map through `companyMap` in the submit pipeline — the
      // display name must not fall back onto a `contact.<name>` property.
      if (fld.type === "company") continue;
      const value = values[fld.name];
      if (value === undefined) continue;
      const mapping = (fld.hubspot ?? {}) as HubspotMapping;
      const object = mapping.object?.trim() || "contact";
      const property = mapping.property?.trim() || fld.name;
      (groups[object] ??= {})[property] = value;
    }
  }
  return groups;
}

/**
 * Every CRM mapping of a definition, checked against the portal schema — the
 * builder's save-time equivalent of the content-type validation middleware.
 * A select's own options are checked against the enumeration too.
 */
export function mappingProblems(
  definition: FormDefinition,
  portalProperties: Parameters<typeof checkMapping>[0],
): (Problem & { fieldId: string })[] {
  const problems: (Problem & { fieldId: string })[] = [];
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      // A company field maps several data at once — check each entry.
      for (const mapping of Object.values((fld.companyMap ?? {}) as CompanyMap)) {
        if (!mapping?.property?.trim()) continue;
        const problem = checkMapping(portalProperties, {
          object: mapping.object?.trim() || "company",
          property: mapping.property,
        });
        if (problem) problems.push({ ...problem, fieldId: fld.id });
      }
      const mapping = (fld.hubspot ?? {}) as HubspotMapping;
      if (!mapping.property) continue;
      const options = fld.options as { value?: string }[] | undefined;
      const problem = checkMapping(portalProperties, {
        object: mapping.object?.trim() || "contact",
        property: mapping.property,
        values: options?.map((o) => o.value ?? "").filter(Boolean),
      });
      if (problem) problems.push({ ...problem, fieldId: fld.id });
    }
  }
  return problems;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** First value that looks like an email — the field named `email` wins. */
export function findEmail(values: Record<string, unknown>): string | undefined {
  const candidates = [values.email, ...Object.values(values)];
  for (const v of candidates) {
    if (typeof v === "string" && EMAIL_RE.test(v.trim())) return v.trim().toLowerCase();
  }
  return undefined;
}

/** Free-mail domains never become a Company (a personal address ≠ a company). */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr",
  "outlook.com", "outlook.fr", "live.com", "live.fr", "msn.com", "icloud.com", "me.com",
  "aol.com", "free.fr", "orange.fr", "wanadoo.fr", "sfr.fr", "laposte.net", "gmx.com",
  "proton.me", "protonmail.com", "yopmail.com",
]);

export function corporateDomain(email?: string): string | undefined {
  const domain = email?.split("@")[1]?.toLowerCase();
  return domain && !FREEMAIL.has(domain) ? domain : undefined;
}

export const SUBMISSION_UID = "plugin::hubspot.submission";

/** Anti-abuse bounds for the public endpoint. */
const MAX_FIELDS = 40;
const MAX_VALUE_LEN = 5000;

/**
 * The raw request body → a flat bag of primitives, or null when the shape is
 * abusive (not an object, too many keys). Non-primitive values are dropped —
 * the definition decides what counts anyway — and long strings are clipped.
 */
export function sanitizeRawValues(raw: unknown): Record<string, Primitive> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_FIELDS) return null;
  const values: Record<string, Primitive> = {};
  for (const [key, value] of entries) {
    if (typeof value === "string") values[key] = value.slice(0, MAX_VALUE_LEN);
    else if (typeof value === "boolean" || typeof value === "number") values[key] = value;
  }
  return values;
}

const HS_BASE = "https://api.hubapi.com";
const HS_COMPANIES = `${HS_BASE}/crm/v3/objects/companies`;
const HS_NOTES = `${HS_BASE}/crm/v3/objects/notes`;

/** HubSpot default association type ids (note → object). */
const ASSOC_NOTE_TO_CONTACT = 202;
const ASSOC_NOTE_TO_COMPANY = 190;

export interface SubmitMeta {
  pagePath?: string;
  pageUrl?: string;
  originPath?: string;
  originLabel?: string;
  [key: string]: unknown;
}

export interface SubmitOutcome {
  ok: boolean;
  hubspotSynced?: boolean;
  missingRequired?: { id: string; name: string; label: string }[];
}

interface FormsConfig {
  companyFromDomain?: boolean;
  timelineNote?: boolean;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function hsJson<T>(
  apiKey: string,
  url: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init.method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message || `HubSpot ${res.status}`);
  return body;
}

/** Human recap of the answers, resolving option values to their labels. */
function summaryLines(definition: FormDefinition, values: Record<string, Primitive>): string[] {
  const lines: string[] = [];
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      const value = values[fld.name];
      if (value === undefined) continue;
      const options = fld.options as { value?: string; label?: string }[] | undefined;
      const label = options?.find((o) => o.value === String(value))?.label;
      lines.push(
        `<strong>${escapeHtml(fld.label ?? fld.name)}</strong> : ${escapeHtml(String(label ?? value))}`,
      );
    }
  }
  return lines;
}

/** What a company field contributed to a submission — persisted with it. */
export interface CompanyRecord {
  field: string;
  siret?: string;
  name?: string;
  /** True when the SIRET was re-resolved against SIRENE server-side. */
  resolved: boolean;
  closed?: boolean;
}

const SIRET_SHAPE = /^\d{14}$/;

/**
 * The browser's snapshot of the selected hit (`<name>__company`), used ONLY
 * when the live re-resolution failed: parsed defensively, whitelisted keys,
 * clipped strings — never trusted further than a display fallback.
 */
export function parseCompanySnapshot(raw: unknown): CompanyHit | null {
  if (typeof raw !== "string" || !raw || raw.length > 5000) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const str = (v: unknown, cap = 300) => (typeof v === "string" ? v.slice(0, cap) : undefined);
  const hit: CompanyHit = {
    siret: SIRET_SHAPE.test(String(parsed.siret ?? "")) ? String(parsed.siret) : "",
    siren: /^\d{9}$/.test(String(parsed.siren ?? "")) ? String(parsed.siren) : "",
    name: str(parsed.name) ?? "",
    address: str(parsed.address),
    zip: str(parsed.zip, 20),
    city: str(parsed.city),
    headquarters: parsed.headquarters === true,
    naf: str(parsed.naf, 10),
    nafLabel: str(parsed.nafLabel),
    headcount: str(parsed.headcount, 50),
  };
  return hit.name || hit.siret ? hit : null;
}

export function createFormsService(
  strapi: Core.Strapi,
  _opts: { sleep?: (ms: number) => Promise<void> } = {},
) {
  const formsConfig = (): Required<FormsConfig> => ({
    companyFromDomain: true,
    timelineNote: true,
    ...(strapi.plugin("hubspot").config("forms", {}) as FormsConfig),
  });

  /**
   * Drops the properties the portal would reject — HubSpot fails an upsert
   * wholesale on one unknown property, so a stale mapping must cost one
   * answer, not the whole lead. An unreachable schema skips the check.
   */
  async function partitionBySchema(
    apiKey: string,
    groups: Record<string, Record<string, Primitive>>,
  ): Promise<{ accepted: Record<string, Record<string, Primitive>>; rejected: Problem[] }> {
    let schema;
    try {
      schema = await loadSchema(
        strapi,
        apiKey,
        resolveObjects(strapi.plugin("hubspot").config("objects", [])),
      );
    } catch {
      return { accepted: groups, rejected: [] };
    }
    const accepted: Record<string, Record<string, Primitive>> = {};
    const rejected: Problem[] = [];
    for (const [object, props] of Object.entries(groups)) {
      for (const [property, value] of Object.entries(props)) {
        const problem = checkMapping(schema.properties, {
          object,
          property,
          values: String(value).split(";").map((v) => v.trim()).filter(Boolean),
        });
        if (problem) rejected.push(problem);
        else (accepted[object] ??= {})[property] = value;
      }
    }
    return { accepted, rejected };
  }

  /** Dedup by the mapped SIRET property: search it, update on hit, else null. */
  async function findCompanyBySiret(
    apiKey: string,
    siretProperty: string,
    siretValue: string,
    props: Record<string, Primitive>,
  ): Promise<string | undefined> {
    const found = await hsJson<{ results?: { id: string }[] }>(apiKey, `${HS_COMPANIES}/search`, {
      method: "POST",
      body: {
        filterGroups: [
          { filters: [{ propertyName: siretProperty, operator: "EQ", value: siretValue }] },
        ],
        properties: [siretProperty],
        limit: 1,
      },
    });
    const existingId = found.results?.[0]?.id;
    if (!existingId) return undefined;
    const stringProps: Record<string, string> = {};
    for (const [key, value] of Object.entries(props)) stringProps[key] = String(value);
    await hsJson(apiKey, `${HS_COMPANIES}/${existingId}`, {
      method: "PATCH",
      body: { properties: stringProps },
    });
    return existingId;
  }

  /** Bare creation with the INSEE-derived properties — no dedup key matched. */
  async function createCompany(
    apiKey: string,
    props: Record<string, Primitive>,
  ): Promise<string | undefined> {
    const stringProps: Record<string, string> = {};
    for (const [key, value] of Object.entries(props)) stringProps[key] = String(value);
    const created = await hsJson<{ id?: string }>(apiKey, HS_COMPANIES, {
      method: "POST",
      body: { properties: stringProps },
    });
    return created.id;
  }

  /** `domain` isn't upsert-able in HubSpot: search it, then update-or-create. */
  async function resolveCompanyByDomain(
    apiKey: string,
    domain: string,
    props: Record<string, Primitive>,
  ): Promise<string | undefined> {
    const found = await hsJson<{ results?: { id: string }[] }>(apiKey, `${HS_COMPANIES}/search`, {
      method: "POST",
      body: {
        filterGroups: [{ filters: [{ propertyName: "domain", operator: "EQ", value: domain }] }],
        properties: ["domain"],
        limit: 1,
      },
    });
    const stringProps: Record<string, string> = { domain };
    for (const [key, value] of Object.entries(props)) stringProps[key] = String(value);
    const existingId = found.results?.[0]?.id;
    if (existingId) {
      await hsJson(apiKey, `${HS_COMPANIES}/${existingId}`, {
        method: "PATCH",
        body: { properties: stringProps },
      });
      return existingId;
    }
    const created = await hsJson<{ id?: string }>(apiKey, HS_COMPANIES, {
      method: "POST",
      body: { properties: stringProps },
    });
    return created.id;
  }

  /** Timeline note on the contact (and company): the lead, readable in the CRM. */
  async function createLeadNote(
    apiKey: string,
    opts: {
      contactId: string;
      companyId?: string;
      form: FormEntry;
      meta: SubmitMeta;
      values: Record<string, Primitive>;
      rejected: Problem[];
      companies?: CompanyRecord[];
    },
  ): Promise<void> {
    const lines: string[] = [];
    const title = opts.form.title || opts.form.name;
    lines.push(`<strong>Nouveau lead${title ? ` — ${escapeHtml(String(title))}` : ""}</strong>`);
    if (opts.meta.pageUrl) lines.push(`Page : ${escapeHtml(String(opts.meta.pageUrl))}`);
    if (opts.meta.originLabel) {
      const path = opts.meta.originPath ? ` (${escapeHtml(String(opts.meta.originPath))})` : "";
      lines.push(`<strong>Sujet</strong> : ${escapeHtml(String(opts.meta.originLabel))}${path}`);
    }
    for (const record of opts.companies ?? []) {
      if (!record.name && !record.siret) continue;
      const bits = [record.name, record.siret ? `SIRET ${record.siret}` : ""].filter(Boolean);
      const flags = [
        record.resolved ? "" : "non résolue via SIRENE",
        record.closed ? "établissement fermé" : "",
      ].filter(Boolean);
      lines.push(
        `<strong>Entreprise</strong> : ${escapeHtml(bits.join(" — "))}${
          flags.length ? ` (${escapeHtml(flags.join(", "))})` : ""
        }`,
      );
    }
    lines.push("", ...summaryLines(opts.form.definition, opts.values));
    if (opts.rejected.length) {
      lines.push("", "<strong>⚠ Champs non enregistrés (mapping à corriger)</strong>");
      for (const r of opts.rejected) {
        lines.push(`${escapeHtml(r.object)}.${escapeHtml(r.property)} — ${escapeHtml(r.code)}`);
      }
    }
    const associations: unknown[] = [
      {
        to: { id: opts.contactId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_NOTE_TO_CONTACT },
        ],
      },
    ];
    if (opts.companyId) {
      associations.push({
        to: { id: opts.companyId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC_NOTE_TO_COMPANY },
        ],
      });
    }
    await hsJson(apiKey, HS_NOTES, {
      method: "POST",
      body: {
        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: lines.join("<br>") },
        associations,
      },
    });
  }

  async function submit(
    form: FormEntry,
    rawValues: Record<string, unknown>,
    meta: SubmitMeta = {},
  ): Promise<SubmitOutcome> {
    const resolution = resolveSubmission(form.definition, rawValues);
    if (resolution.missingRequired.length) {
      return { ok: false, missingRequired: resolution.missingRequired };
    }

    const email = findEmail(resolution.values);
    const { apiKey } = await resolveApiKey(strapi);
    const config = formsConfig();

    let hubspotSynced = false;
    let contactId: string | undefined;
    let companyId: string | undefined;
    let rejected: Problem[] = [];

    // Company fields (INSEE/SIRENE): the browser only nominated a SIRET — the
    // server re-resolves it and owns the data that reaches the CRM. The
    // browser snapshot is a display-grade fallback for an API outage, and a
    // plain typed name maps through `companyMap.name` alone.
    const companyRecords: CompanyRecord[] = [];
    const companyGroups: Record<string, Record<string, Primitive>> = {};
    let siretDedup: { property: string; value: string } | undefined;
    for (const step of form.definition.steps ?? []) {
      for (const fld of step.fields ?? []) {
        if (fld.type !== "company" || resolution.hidden.includes(fld.name)) continue;
        const typed = resolution.values[fld.name];
        const siretRaw = rawValues[`${fld.name}__siret`];
        const siret = typeof siretRaw === "string" && SIRET_SHAPE.test(siretRaw.trim())
          ? siretRaw.trim()
          : "";
        if (typed === undefined && !siret) continue;
        const map = (fld.companyMap ?? {}) as CompanyMap;

        let hit = siret ? await resolveSiret(siret) : null;
        const resolved = Boolean(hit);
        if (!hit && siret) hit = parseCompanySnapshot(rawValues[`${fld.name}__company`]);

        if (hit) {
          for (const [object, props] of Object.entries(companyProperties(map, hit))) {
            companyGroups[object] = { ...(companyGroups[object] ?? {}), ...props };
          }
          const siretProperty =
            (map.siret?.object?.trim() || "company") === "company"
              ? map.siret?.property?.trim()
              : undefined;
          if (!siretDedup && siretProperty && hit.siret) {
            siretDedup = { property: siretProperty, value: hit.siret };
          }
        } else if (typed !== undefined && map.name?.property?.trim()) {
          const object = map.name.object?.trim() || "company";
          (companyGroups[object] ??= {})[map.name.property.trim()] = typed;
        }
        companyRecords.push({
          field: fld.name,
          siret: hit?.siret || undefined,
          name: hit?.name || (typeof typed === "string" ? typed : undefined),
          resolved,
          closed: hit?.closed || undefined,
        });
      }
    }

    // Best-effort CRM sync — a HubSpot outage must never lose the lead.
    if (email && apiKey) {
      const groups = groupByObject(form.definition, resolution.values);
      for (const [object, props] of Object.entries(companyGroups)) {
        groups[object] = { ...(groups[object] ?? {}), ...props };
      }
      const partition = await partitionBySchema(apiKey, groups);
      rejected = partition.rejected;

      const result = await strapi
        .plugin("hubspot")
        .service("submit")
        .upsert({
          object: "contact",
          idProperty: "email",
          properties: { ...(partition.accepted.contact ?? {}), email },
        });
      if (result.ok) {
        hubspotSynced = true;
        contactId = result.id;
      }

      // Dedup order: mapped SIRET property → corporate email domain → bare
      // creation with the INSEE data. A personal email with a resolved SIRET
      // therefore still gets its Company — the exact case the field exists for.
      const domain = corporateDomain(email);
      const companyProps = partition.accepted.company ?? {};
      const wantsCompany =
        Boolean(siretDedup) || Boolean(domain && config.companyFromDomain);
      if (contactId && wantsCompany) {
        try {
          if (siretDedup) {
            companyId = await findCompanyBySiret(
              apiKey,
              siretDedup.property,
              siretDedup.value,
              companyProps,
            );
          }
          if (!companyId && domain && config.companyFromDomain) {
            companyId = await resolveCompanyByDomain(apiKey, domain, companyProps);
          }
          if (!companyId && siretDedup) {
            companyId = await createCompany(apiKey, companyProps);
          }
          if (companyId) {
            await hsJson(
              apiKey,
              `${HS_BASE}/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`,
              { method: "PUT" },
            );
          }
        } catch (err) {
          strapi.log.warn(`[hubspot] company sync failed (contact OK) — ${(err as Error).message}`);
        }
      }

      if (contactId && config.timelineNote) {
        try {
          await createLeadNote(apiKey, {
            contactId,
            companyId,
            form,
            meta,
            values: resolution.values,
            rejected,
            companies: companyRecords,
          });
        } catch (err) {
          strapi.log.warn(`[hubspot] lead note failed (contact OK) — ${(err as Error).message}`);
        }
      }
    }

    // Source of truth: the submission row. If THIS throws, the caller reports
    // an error and the visitor can retry — the upserts are idempotent.
    await strapi.documents(SUBMISSION_UID as never).create({
      data: {
        form: form.slug,
        formTitle: form.title || form.name,
        email,
        values: resolution.values,
        meta,
        locale: form.locale ?? null,
        hubspotSynced,
        contactId,
        companyId,
        rejected,
        companies: companyRecords,
      } as never,
    });

    return { ok: true, hubspotSynced };
  }

  return { submit };
}
