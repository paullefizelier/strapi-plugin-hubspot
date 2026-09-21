import { afterEach, describe, expect, it, vi } from "vitest";
import type { Core } from "@strapi/strapi";
import {
  ENV_DEFAULT_FORM,
  ENV_PORTAL,
  ENV_REGION,
  ENV_VAR,
  publicSettings,
  resolveAccount,
  resolveApiKey,
} from "../settings";

function makeStrapi({
  stored = {},
  config = {},
}: {
  stored?: Record<string, string>;
  config?: Record<string, unknown>;
} = {}) {
  return {
    store: () => ({
      get: async () => stored,
      set: async () => undefined,
    }),
    plugin: () => ({
      config: (key: string, fallback: unknown) =>
        Object.prototype.hasOwnProperty.call(config, key) ? config[key] : fallback,
    }),
  } as unknown as Core.Strapi;
}

afterEach(() => {
  delete process.env[ENV_VAR];
  delete process.env[ENV_PORTAL];
  delete process.env[ENV_REGION];
  delete process.env[ENV_DEFAULT_FORM];
});

describe("resolveApiKey", () => {
  it("prefers the admin-saved key over config and env", async () => {
    process.env[ENV_VAR] = "env-key";
    const strapi = makeStrapi({ stored: { apiKey: "ui-key" }, config: { apiKey: "cfg-key" } });
    await expect(resolveApiKey(strapi)).resolves.toEqual({ apiKey: "ui-key", source: "settings" });
  });
});

describe("resolveAccount", () => {
  it("reads portal, region and default form from the settings UI first", async () => {
    process.env[ENV_PORTAL] = "1";
    process.env[ENV_REGION] = "na1";
    process.env[ENV_DEFAULT_FORM] = "env-guid";
    const strapi = makeStrapi({
      stored: { portalId: "148991818", region: "eu1", defaultFormId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      config: { portalId: "9", region: "na1", forms: { defaultFormId: "cfg" } },
    });
    await expect(resolveAccount(strapi)).resolves.toEqual({
      portalId: "148991818",
      region: "eu1",
      defaultFormId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
  });

  it("falls back to env when the UI is empty, then defaults region to eu1", async () => {
    process.env[ENV_PORTAL] = "42";
    const strapi = makeStrapi();
    const account = await resolveAccount(strapi);
    expect(account).toEqual({ portalId: "42", region: "eu1", defaultFormId: "" });
    const pub = await publicSettings(strapi);
    expect(pub.portalSource).toBe("env");
    expect(pub.region).toBe("eu1");
    expect(pub.regionSource).toBeNull();
    expect(pub.formSource).toBeNull();
  });
});
