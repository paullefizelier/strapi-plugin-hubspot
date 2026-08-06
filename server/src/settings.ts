import type { Core } from "@strapi/strapi";
import { clearCache } from "./properties";

/**
 * API key resolution, in order of precedence:
 *  1. saved from the admin UI (plugin core store)
 *  2. plugin config (config/plugins of the host app)
 *  3. environment variable (HUBSPOT_API_KEY)
 *
 * The key is only ever read server-side; `publicSettings` is what the admin UI
 * receives, and it deliberately never carries the key itself.
 */

export const ENV_VAR = "HUBSPOT_API_KEY";

export interface StoredSettings {
  apiKey?: string;
}

export interface PublicSettings {
  configured: boolean;
  /** Where the key comes from, so the UI can explain why it can't be edited. */
  keySource: "settings" | "config" | "env" | null;
  /** Last four characters, enough to recognise a key without exposing it. */
  hint: string;
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

export async function resolveApiKey(
  strapi: Core.Strapi,
): Promise<{ apiKey: string; source: PublicSettings["keySource"] }> {
  const stored = await getStoredSettings(strapi);
  if (stored.apiKey) return { apiKey: stored.apiKey, source: "settings" };

  const fromConfig = strapi.plugin("hubspot").config("apiKey", "") as string;
  if (fromConfig) return { apiKey: fromConfig, source: "config" };

  const fromEnv = process.env[ENV_VAR];
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  return { apiKey: "", source: null };
}

export async function publicSettings(strapi: Core.Strapi): Promise<PublicSettings> {
  const { apiKey, source } = await resolveApiKey(strapi);
  return {
    configured: Boolean(apiKey),
    keySource: source,
    hint: apiKey ? `…${apiKey.slice(-4)}` : "",
  };
}
