/**
 * HubSpot marketing Forms API — native form submissions.
 *
 * CRM upserts never count as form conversions: Original Source stays
 * "Offline / Integration", workflows that listen to a form don't fire, and
 * the lead-center notification attached to the form never runs. Posting to
 * `/submissions/v3/integration/secure/submit/{portalId}/{formGuid}` with the
 * visitor's `hutk` is what HubSpot treats as a real conversion.
 *
 * Portal id, region and form GUIDs are configuration — a test portal today,
 * production tomorrow, no code change.
 */

import { fetchHubspotForm } from "./importHubspot";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PORTAL = /^\d{1,12}$/;
const HUTK = /^[a-f0-9]{8,128}$/i;
const SHAPE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONSENT_TEXT =
  "J'accepte que mes données soient utilisées pour me recontacter.";

export function isFormGuid(value: string): boolean {
  return GUID.test(value.trim());
}

export function sanitizeHutk(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return HUTK.test(trimmed) ? trimmed : undefined;
}

export function sanitizePortalId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const trimmed = String(value).trim();
  return PORTAL.test(trimmed) ? trimmed : undefined;
}

export function sanitizeIp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 45 ? trimmed : undefined;
}

/** Forms submit host. CRM stays on api.hubapi.com; this endpoint is regional. */
export function formsHost(region: string): string {
  const r = (region || "eu1").trim().toLowerCase();
  if (!r || r === "na1" || r === "na") return "api.hsforms.com";
  return `api-${r}.hsforms.com`;
}

export function formsSubmitUrl(portalId: string, formGuid: string, region = "eu1"): string {
  return `https://${formsHost(region)}/submissions/v3/integration/secure/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formGuid)}`;
}

export function trackingScriptUrl(portalId: string, region = "eu1"): string {
  const r = (region || "eu1").trim().toLowerCase();
  if (!r || r === "na1" || r === "na") return `https://js.hs-scripts.com/${portalId}.js`;
  return `https://js-${r}.hs-scripts.com/${portalId}.js`;
}

export function toHsFields(props: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(props)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => ({ name, value }));
}

export function filterToFormFields(
  fields: { name: string; value: string }[],
  allowed: Set<string> | null,
): { name: string; value: string }[] {
  if (!allowed) return fields;
  return fields.filter((field) => allowed.has(field.name));
}

export function formFieldNames(raw: {
  fieldGroups?: { fields?: { name?: string }[] }[];
}): string[] {
  const names: string[] = [];
  for (const group of raw.fieldGroups ?? []) {
    for (const field of group.fields ?? []) {
      if (field.name) names.push(field.name);
    }
  }
  return names;
}

export interface FormSubmitContext {
  hutk?: string;
  pageUri?: string;
  pageName?: string;
  ipAddress?: string;
}

export interface FormSubmitInput {
  apiKey: string;
  portalId: string;
  formGuid: string;
  region?: string;
  fields: { name: string; value: string }[];
  context?: FormSubmitContext;
  consent?: { given: boolean; text?: string };
  formHasLegalConsent?: boolean;
}

const shapeCache = new Map<
  string,
  { at: number; names: Set<string>; hasLegalConsent: boolean }
>();

export async function loadFormShape(
  apiKey: string,
  formGuid: string,
): Promise<{ names: Set<string>; hasLegalConsent: boolean } | null> {
  const cached = shapeCache.get(formGuid);
  if (cached && Date.now() - cached.at < SHAPE_TTL_MS) {
    return { names: cached.names, hasLegalConsent: cached.hasLegalConsent };
  }
  try {
    const raw = await fetchHubspotForm(apiKey, formGuid);
    const names = new Set(formFieldNames(raw));
    const hasLegalConsent = Boolean(
      raw.legalConsentOptions &&
        typeof raw.legalConsentOptions === "object" &&
        raw.legalConsentOptions.type &&
        raw.legalConsentOptions.type !== "none",
    );
    shapeCache.set(formGuid, { at: Date.now(), names, hasLegalConsent });
    return { names, hasLegalConsent };
  } catch {
    return null;
  }
}

export async function findContactIdByEmail(
  apiKey: string,
  email: string,
): Promise<string | undefined> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
      properties: ["email"],
      limit: 1,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { results?: { id?: string }[] };
  if (!res.ok) return undefined;
  return body.results?.[0]?.id;
}

function contextPayload(ctx: FormSubmitContext | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const hutk = sanitizeHutk(ctx?.hutk);
  if (hutk) out.hutk = hutk;
  if (typeof ctx?.pageUri === "string" && ctx.pageUri.trim()) {
    out.pageUri = ctx.pageUri.trim().slice(0, 1000);
  }
  if (typeof ctx?.pageName === "string" && ctx.pageName.trim()) {
    out.pageName = ctx.pageName.trim().slice(0, 200);
  }
  const ip = sanitizeIp(ctx?.ipAddress);
  if (ip) out.ipAddress = ip;
  return out;
}

async function postForm(
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true, status: res.status };
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    errors?: { message?: string }[];
  };
  const error = body.errors?.[0]?.message || body.message || `HubSpot ${res.status}`;
  return { ok: false, status: res.status, error };
}

/**
 * Submit a marketing form. Extra fields HubSpot doesn't know on that form
 * 400 the whole request, so callers should filter first; we still retry
 * without legal-consent and then email-only if HubSpot refuses the payload.
 */
export async function submitMarketingForm(
  input: FormSubmitInput,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const portalId = sanitizePortalId(input.portalId);
  const formGuid = input.formGuid.trim();
  if (!portalId || !isFormGuid(formGuid) || !input.fields.length) {
    return { ok: false, status: 0, error: "Missing portal, form GUID or fields" };
  }
  const url = formsSubmitUrl(portalId, formGuid, input.region);
  const context = contextPayload(input.context);
  const base: Record<string, unknown> = {
    fields: input.fields,
    ...(Object.keys(context).length ? { context } : {}),
  };

  const withConsent =
    input.consent?.given && input.formHasLegalConsent !== false
      ? {
          ...base,
          legalConsentOptions: {
            consent: {
              consentToProcess: true,
              text: input.consent.text?.trim() || DEFAULT_CONSENT_TEXT,
            },
          },
        }
      : base;

  let result = await postForm(url, input.apiKey, withConsent);
  if (!result.ok && result.status === 400 && withConsent !== base) {
    result = await postForm(url, input.apiKey, base);
  }
  if (!result.ok && result.status === 400 && input.fields.length > 1) {
    const email = input.fields.find((f) => f.name === "email");
    if (email) result = await postForm(url, input.apiKey, { ...base, fields: [email] });
  }
  return result;
}
