import type { Core } from "@strapi/strapi";
import { clearCache } from "./properties";

/**
 * API key + portal resolution, in order of precedence:
 *  1. saved from the admin UI (plugin core store)
 *  2. plugin config (config/plugins of the host app)
 *  3. environment variable
 *
 * The key is only ever read server-side; `publicSettings` is what the admin UI
 * receives, and it deliberately never carries the key itself. Portal id, region
 * and the default form GUID are not secrets — they round-trip so they can be
 * edited in Settings → HubSpot.
 */

export const ENV_VAR = "HUBSPOT_API_KEY";
export const ENV_PORTAL = "HUBSPOT_PORTAL_ID";
export const ENV_REGION = "HUBSPOT_REGION";
export const ENV_DEFAULT_FORM = "HUBSPOT_DEFAULT_FORM_ID";

export type SettingSource = "settings" | "config" | "env" | null;

export type SubmissionMode = "auto" | "crm" | "forms";

export interface StoredSettings {
  apiKey?: string;
  portalId?: string;
  region?: string;
  defaultFormId?: string;
  submissionMode?: SubmissionMode;
  writeExtraProperties?: boolean;
  syncFieldsOnPublish?: boolean;
}

export interface HubspotPolicy {
  /** How submissions reach HubSpot. `auto` uses Forms API when a GUID is set. */
  submissionMode: SubmissionMode;
  /** After a Forms API conversion, CRM-write mapped contact props the form dropped. */
  writeExtraProperties: boolean;
  /** On publish, PATCH missing mapped contact fields onto the HubSpot form. */
  syncFieldsOnPublish: boolean;
}

export interface PublicSettings {
  configured: boolean;
  /** Where the key comes from, so the UI can explain why it can't be edited. */
  keySource: SettingSource;
  /** Last four characters, enough to recognise a key without exposing it. */
  hint: string;
  portalId: string;
  region: string;
  defaultFormId: string;
  portalSource: SettingSource;
  regionSource: SettingSource;
  formSource: SettingSource;
  submissionMode: SubmissionMode;
  writeExtraProperties: boolean;
  syncFieldsOnPublish: boolean;
}

export interface HubspotAccount {
  portalId: string;
  region: string;
  defaultFormId: string;
}

const store = (strapi: Core.Strapi) => strapi.store({ type: "plugin", name: "hubspot" });

export async function getStoredSettings(strapi: Core.Strapi): Promise<StoredSettings> {
  return ((await store(strapi).get({ key: "settings" })) as StoredSettings) ?? {};
}

export async function setStoredSettings(
  strapi: Core.Strapi,
  value: StoredSettings | null,
): Promise<void> {
  await store(strapi).set({ key: "settings", value });
  // The cached schema belongs to the old portal — drop it.
  clearCache();
}

const first = (
  values: { value?: string; source: Exclude<SettingSource, null> }[],
  fallback = "",
): { value: string; source: SettingSource } => {
  for (const item of values) {
    const value = (item.value ?? "").trim();
    if (value) return { value, source: item.source };
  }
  return { value: fallback, source: null };
};

const MODES = new Set<SubmissionMode>(["auto", "crm", "forms"]);

export function asSubmissionMode(value: unknown): SubmissionMode | undefined {
  return typeof value === "string" && MODES.has(value as SubmissionMode)
    ? (value as SubmissionMode)
    : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

interface FormsCfg {
  defaultFormId?: string;
  submissionMode?: unknown;
  writeExtraProperties?: unknown;
  syncFieldsOnPublish?: unknown;
}

function formsCfg(strapi: Core.Strapi): FormsCfg {
  return (strapi.plugin("hubspot").config("forms", {}) as FormsCfg) ?? {};
}

export function policyFrom(stored: StoredSettings, forms: FormsCfg): HubspotPolicy {
  return {
    submissionMode: asSubmissionMode(stored.submissionMode) ?? asSubmissionMode(forms.submissionMode) ?? "auto",
    writeExtraProperties:
      asBool(stored.writeExtraProperties) ?? asBool(forms.writeExtraProperties) ?? true,
    syncFieldsOnPublish:
      asBool(stored.syncFieldsOnPublish) ?? asBool(forms.syncFieldsOnPublish) ?? false,
  };
}

export async function resolvePolicy(strapi: Core.Strapi): Promise<HubspotPolicy> {
  return policyFrom(await getStoredSettings(strapi), formsCfg(strapi));
}

export async function resolveApiKey(
  strapi: Core.Strapi,
): Promise<{ apiKey: string; source: SettingSource }> {
  const stored = await getStoredSettings(strapi);
  if (stored.apiKey) return { apiKey: stored.apiKey, source: "settings" };

  const fromConfig = strapi.plugin("hubspot").config("apiKey", "") as string;
  if (fromConfig) return { apiKey: fromConfig, source: "config" };

  const fromEnv = process.env[ENV_VAR];
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  return { apiKey: "", source: null };
}

/** Portal / region / default marketing form — settings UI overrides env. */
export async function resolveAccount(strapi: Core.Strapi): Promise<HubspotAccount> {
  const resolved = await resolveAccountSources(strapi);
  return {
    portalId: resolved.portalId,
    region: resolved.region || "eu1",
    defaultFormId: resolved.defaultFormId,
  };
}

async function resolveAccountSources(strapi: Core.Strapi): Promise<PublicSettings> {
  const stored = await getStoredSettings(strapi);
  const forms = formsCfg(strapi);
  const portal = first([
    { value: stored.portalId, source: "settings" },
    { value: strapi.plugin("hubspot").config("portalId", "") as string, source: "config" },
    { value: process.env[ENV_PORTAL], source: "env" },
  ]);
  const region = first(
    [
      { value: stored.region, source: "settings" },
      { value: strapi.plugin("hubspot").config("region", "") as string, source: "config" },
      { value: process.env[ENV_REGION], source: "env" },
    ],
    "eu1",
  );
  const form = first([
    { value: stored.defaultFormId, source: "settings" },
    { value: forms.defaultFormId, source: "config" },
    { value: process.env[ENV_DEFAULT_FORM], source: "env" },
  ]);
  const { apiKey, source: keySource } = await resolveApiKey(strapi);
  const policy = policyFrom(stored, forms);
  return {
    configured: Boolean(apiKey),
    keySource,
    hint: apiKey ? `…${apiKey.slice(-4)}` : "",
    portalId: portal.value,
    region: region.value || "eu1",
    defaultFormId: form.value,
    portalSource: portal.source,
    regionSource: region.source,
    formSource: form.source,
    ...policy,
  };
}

export async function publicSettings(strapi: Core.Strapi): Promise<PublicSettings> {
  return resolveAccountSources(strapi);
}

export interface SettingsPatch {
  apiKey?: string;
  portalId?: unknown;
  region?: unknown;
  defaultFormId?: unknown;
  submissionMode?: unknown;
  writeExtraProperties?: unknown;
  syncFieldsOnPublish?: unknown;
}

/** Merge a PATCH-like body into the store without dropping the saved key. */
export async function patchStoredSettings(strapi: Core.Strapi, body: SettingsPatch): Promise<void> {
  const current = await getStoredSettings(strapi);
  const next: StoredSettings = { ...current };
  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    next.apiKey = body.apiKey.trim();
  }
  if ("portalId" in body) next.portalId = String(body.portalId ?? "").trim();
  if ("region" in body) {
    const region = String(body.region ?? "").trim().toLowerCase();
    next.region = region || "eu1";
  }
  if ("defaultFormId" in body) next.defaultFormId = String(body.defaultFormId ?? "").trim();
  if ("submissionMode" in body) {
    const mode = asSubmissionMode(body.submissionMode);
    if (mode) next.submissionMode = mode;
  }
  if ("writeExtraProperties" in body && typeof body.writeExtraProperties === "boolean") {
    next.writeExtraProperties = body.writeExtraProperties;
  }
  if ("syncFieldsOnPublish" in body && typeof body.syncFieldsOnPublish === "boolean") {
    next.syncFieldsOnPublish = body.syncFieldsOnPublish;
  }
  await setStoredSettings(strapi, next);
}

/** Drop only the stored token; portal / form settings stay. */
export async function clearStoredApiKey(strapi: Core.Strapi): Promise<void> {
  const current = await getStoredSettings(strapi);
  const { apiKey: _apiKey, ...rest } = current;
  const empty = !rest.portalId && !rest.region && !rest.defaultFormId;
  await setStoredSettings(strapi, empty ? null : rest);
}
