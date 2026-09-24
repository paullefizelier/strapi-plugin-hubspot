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

import { appendFieldGroups, applyVisibleIfToFieldGroups, mappedContactFields, missingMappedFields, toHsFormField } from "./formSync";
import type { FormDefinition } from "./conditions";
import { fetchHubspotForm, patchHubspotForm } from "./importHubspot";

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

export function filterToFormFields<T extends { name: string }>(
  fields: T[],
  allowed: Set<string> | null,
): T[] {
  if (!allowed) return fields;
  return fields.filter((field) => allowed.has(field.name));
}

export function formFieldNames(raw: {
  fieldGroups?: { fields?: { name?: string; required?: boolean }[] }[];
}): string[] {
  const names: string[] = [];
  for (const group of raw.fieldGroups ?? []) {
    for (const field of group.fields ?? []) {
      if (field.name) names.push(field.name);
    }
  }
  return names;
}

export function formRequiredNames(raw: {
  fieldGroups?: { fields?: { name?: string; required?: boolean }[] }[];
}): string[] {
  const names: string[] = [];
  for (const group of raw.fieldGroups ?? []) {
    for (const field of group.fields ?? []) {
      if (field.name && field.required) names.push(field.name);
    }
  }
  return names;
}

export interface CommunicationConsent {
  subscriptionTypeId: number;
  text: string;
}

export interface FormShapeField {
  name: string;
  objectTypeId: string;
  required: boolean;
}

export interface FormShape {
  names: Set<string>;
  required: Set<string>;
  fields: FormShapeField[];
  hasLegalConsent: boolean;
  legalType?: string;
  lawfulBasis?: "LEAD" | "CUSTOMER";
  subscriptionTypeIds: number[];
  privacyText?: string;
  captcha: boolean;
  consentToProcessText?: string;
  communications: CommunicationConsent[];
}

const OBJECT_BAG: Record<string, string> = {
  "0-1": "contact",
  "0-2": "company",
};

export function formShapeFields(raw: {
  fieldGroups?: { fields?: { name?: string; required?: boolean; objectTypeId?: string }[] }[];
}): FormShapeField[] {
  const fields: FormShapeField[] = [];
  for (const group of raw.fieldGroups ?? []) {
    for (const field of group.fields ?? []) {
      if (!field.name) continue;
      fields.push({
        name: field.name,
        objectTypeId: field.objectTypeId?.trim() || "0-1",
        required: Boolean(field.required),
      });
    }
  }
  return fields;
}

/** Values HubSpot declared on the marketing form, with the right objectTypeId. */
export function fieldsForHubspotForm(
  bags: Record<string, Record<string, string>>,
  shape: FormShape | null | undefined,
  extra: Record<string, string> = {},
): { name: string; value: string; objectTypeId: string }[] {
  const contact = { ...(bags.contact ?? {}), ...extra };
  if (!shape?.fields.length) {
    return toHsFields(contact).map((field) => ({ ...field, objectTypeId: "0-1" }));
  }
  const out: { name: string; value: string; objectTypeId: string }[] = [];
  for (const field of shape.fields) {
    const bagName = OBJECT_BAG[field.objectTypeId] || "contact";
    const value = bags[bagName]?.[field.name] ?? contact[field.name];
    if (!value) continue;
    out.push({ name: field.name, value, objectTypeId: field.objectTypeId || "0-1" });
  }
  return out;
}

export function parseFormShape(raw: {
  fieldGroups?: { fields?: { name?: string; required?: boolean; objectTypeId?: string }[] }[];
  configuration?: { captchaEnabled?: boolean; recaptchaEnabled?: boolean };
  legalConsentOptions?: {
    type?: string;
    lawfulBasis?: string;
    privacyText?: string;
    subscriptionTypeIds?: (number | string)[];
    consentToProcessText?: string;
    communicationsCheckboxes?: {
      label?: string;
      text?: string;
      subscriptionTypeId?: number | string;
      communicationTypeId?: number | string;
    }[];
  } | null;
}): FormShape {
  const legal = raw.legalConsentOptions;
  const legalType = typeof legal?.type === "string" ? legal.type : undefined;
  const hasLegalConsent = Boolean(legalType && legalType !== "none");
  const communications: CommunicationConsent[] = [];
  for (const box of legal?.communicationsCheckboxes ?? []) {
    const id = Number(box.subscriptionTypeId ?? box.communicationTypeId);
    if (!Number.isFinite(id) || id <= 0) continue;
    communications.push({
      subscriptionTypeId: id,
      text: String(box.label || box.text || "").trim() || "I agree to receive communications.",
    });
  }
  const subscriptionTypeIds = (legal?.subscriptionTypeIds ?? [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const consentToProcessText = legal?.consentToProcessText?.trim();
  const privacyText = legal?.privacyText?.trim();
  const lawfulRaw = String(legal?.lawfulBasis || "").toUpperCase();
  const fields = formShapeFields(raw);
  return {
    names: new Set(fields.map((field) => field.name)),
    required: new Set(fields.filter((field) => field.required).map((field) => field.name)),
    fields,
    hasLegalConsent,
    ...(legalType ? { legalType } : {}),
    lawfulBasis: lawfulRaw.includes("CUSTOMER") ? "CUSTOMER" : "LEAD",
    subscriptionTypeIds,
    ...(privacyText ? { privacyText } : {}),
    captcha:
      raw.configuration?.recaptchaEnabled === true || raw.configuration?.captchaEnabled === true,
    ...(consentToProcessText ? { consentToProcessText } : {}),
    communications,
  };
}

/** Email-only retry is only safe when HubSpot doesn't require other fields. */
export function canRetryEmailOnly(required: Iterable<string> | undefined): boolean {
  const names = [...(required ?? [])];
  return names.length === 0 || names.every((name) => name === "email");
}

export function buildLegalConsent(
  shape: Pick<
    FormShape,
    | "hasLegalConsent"
    | "legalType"
    | "lawfulBasis"
    | "subscriptionTypeIds"
    | "privacyText"
    | "communications"
    | "consentToProcessText"
  > | null | undefined,
  given: boolean,
  fallbackText?: string,
): Record<string, unknown> | undefined {
  if (!given) return undefined;
  if (shape && !shape.hasLegalConsent) return undefined;
  const fallback = fallbackText?.trim() || DEFAULT_CONSENT_TEXT;
  if (shape?.legalType === "legitimate_interest") {
    const subscriptionTypeId = shape.subscriptionTypeIds[0];
    if (!subscriptionTypeId) return undefined;
    return {
      legitimateInterest: {
        value: true,
        subscriptionTypeId,
        legalBasis: shape.lawfulBasis || "LEAD",
        text: shape.privacyText?.trim() || fallback,
      },
    };
  }
  const consent: Record<string, unknown> = {
    consentToProcess: true,
    text: shape?.consentToProcessText?.trim() || fallback,
  };
  if (shape?.communications.length) {
    consent.communications = shape.communications.map((item) => ({
      value: true,
      subscriptionTypeId: item.subscriptionTypeId,
      text: item.text,
    }));
  }
  return { consent };
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
  fields: { name: string; value: string; objectTypeId?: string }[];
  context?: FormSubmitContext;
  consent?: { given: boolean; text?: string };
  shape?: FormShape | null;
}

const shapeCache = new Map<string, { at: number; shape: FormShape }>();

export function clearFormShapeCache(formGuid?: string): void {
  if (formGuid) shapeCache.delete(formGuid);
  else shapeCache.clear();
}

export async function loadFormShape(
  apiKey: string,
  formGuid: string,
): Promise<FormShape | null> {
  const cached = shapeCache.get(formGuid);
  if (cached && Date.now() - cached.at < SHAPE_TTL_MS) {
    return cached.shape;
  }
  try {
    const raw = await fetchHubspotForm(apiKey, formGuid);
    const shape = parseFormShape(raw);
    shapeCache.set(formGuid, { at: Date.now(), shape });
    return shape;
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
 * 400 the whole request, so callers should filter first. A GDPR block on the
 * HubSpot form needs the matching legalConsentOptions (including
 * communications); stripping consent to "retry" would 400 forever. Email-only
 * retry is only used when HubSpot doesn't require other fields. CAPTCHA
 * cannot be solved server-side.
 */
export async function submitMarketingForm(
  input: FormSubmitInput,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const portalId = sanitizePortalId(input.portalId);
  const formGuid = input.formGuid.trim();
  if (!portalId || !isFormGuid(formGuid) || !input.fields.length) {
    return { ok: false, status: 0, error: "Missing portal, form GUID or fields" };
  }
  if (input.shape?.captcha) {
    return {
      ok: false,
      status: 0,
      error:
        "HubSpot form has CAPTCHA enabled — the Forms API cannot submit it. Turn CAPTCHA off on that marketing form.",
    };
  }
  const url = formsSubmitUrl(portalId, formGuid, input.region);
  const context = contextPayload(input.context);
  const fields = input.fields.map((field) => ({
    objectTypeId: field.objectTypeId || "0-1",
    name: field.name,
    value: field.value,
  }));
  const base: Record<string, unknown> = {
    fields,
    ...(Object.keys(context).length ? { context } : {}),
  };

  const legal = buildLegalConsent(
    input.shape,
    input.consent?.given === true,
    input.consent?.text,
  );
  const withConsent = legal ? { ...base, legalConsentOptions: legal } : base;

  let result = await postForm(url, input.apiKey, withConsent);
  const mustKeepConsent = Boolean(input.shape?.hasLegalConsent && legal);
  if (!result.ok && result.status === 400 && withConsent !== base && !mustKeepConsent) {
    result = await postForm(url, input.apiKey, base);
  }
  if (
    !result.ok &&
    result.status === 400 &&
    input.fields.length > 1 &&
    canRetryEmailOnly(input.shape?.required)
  ) {
    const email = fields.find((f) => f.name === "email");
    if (email) {
      const slim = { ...base, fields: [email] };
      result = await postForm(
        url,
        input.apiKey,
        legal && mustKeepConsent ? { ...slim, legalConsentOptions: legal } : slim,
      );
    }
  }
  return result;
}

/**
 * Opt-in: add mapped contact fields that the HubSpot form doesn't already
 * declare. Never creates CRM properties — only form fields pointing at ones
 * that already exist. Returns the property names that were added.
 */
export async function syncFieldsToHubspotForm(
  apiKey: string,
  formGuid: string,
  definition: FormDefinition,
): Promise<string[]> {
  const raw = await fetchHubspotForm(apiKey, formGuid);
  const extra = missingMappedFields(definition, formFieldNames(raw));
  const fieldGroups = applyVisibleIfToFieldGroups(
    appendFieldGroups(raw.fieldGroups ?? [], extra),
    definition,
  );
  if (!extra.length && JSON.stringify(fieldGroups) === JSON.stringify(appendFieldGroups(raw.fieldGroups ?? [], []))) {
    return [];
  }
  await patchHubspotForm(apiKey, formGuid, { fieldGroups });
  clearFormShapeCache(formGuid);
  return extra.map((field) => field.property);
}

/** Create a marketing form from the Strapi definition and return its GUID. */
export async function createMarketingForm(
  apiKey: string,
  name: string,
  definition: FormDefinition,
): Promise<string> {
  const fields = mappedContactFields(definition).map((field) => toHsFormField(field));
  if (!fields.length) {
    throw new Error("Add at least one mapped contact field before creating a HubSpot form");
  }
  const res = await fetch("https://api.hubapi.com/marketing/v3/forms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      formType: "hubspot",
      fieldGroups: applyVisibleIfToFieldGroups(
        fields.map((field) => ({
          groupType: "default_group",
          richTextType: "text",
          fields: [field],
        })),
        definition,
      ),
      configuration: {
        language: "fr",
        recaptchaEnabled: false,
        createNewContactForNewEmail: true,
        prePopulateKnownValues: true,
        notifyContactOwner: false,
        notifyRecipients: [],
        editable: true,
        archivable: true,
        cloneable: true,
        allowLinkToResetKnownValues: false,
        postSubmitAction: { type: "thank_you", value: "Merci." },
      },
      displayOptions: { submitButtonText: "Envoyer", style: { submitButtonText: "Envoyer" } },
      legalConsentOptions: { type: "none" },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !body.id) {
    throw new Error(body.message || `HubSpot ${res.status}`);
  }
  return body.id;
}
