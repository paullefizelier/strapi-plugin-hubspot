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

export interface StoredSettings {
  apiKey?: string;
  portalId?: string;
  region?: string;
  defaultFormId?: string;
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
  const formsCfg = (strapi.plugin("hubspot").config("forms", {}) as { defaultFormId?: string }) ?? {};
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
    { value: formsCfg.defaultFormId, source: "config" },
    { value: process.env[ENV_DEFAULT_FORM], source: "env" },
  ]);
  const { apiKey, source: keySource } = await resolveApiKey(strapi);
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
  };
}

export async function publicSettings(strapi: Core.Strapi): Promise<PublicSettings> {
  return resolveAccountSources(strapi);
}

/** Merge a PATCH-like body into the store without dropping the saved key. */
export async function patchStoredSettings(
  strapi: Core.Strapi,
  body: { apiKey?: string; portalId?: unknown; region?: unknown; defaultFormId?: unknown },
): Promise<void> {
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
  await setStoredSettings(strapi, next);
}

/** Drop only the stored token; portal / form settings stay. */
export async function clearStoredApiKey(strapi: Core.Strapi): Promise<void> {
  const current = await getStoredSettings(strapi);
  const { apiKey: _apiKey, ...rest } = current;
  const empty = !rest.portalId && !rest.region && !rest.defaultFormId;
  await setStoredSettings(strapi, empty ? null : rest);
}
