import { afterEach, describe, expect, it } from "vitest";
import type { Core } from "@strapi/strapi";
import {
  ENV_DEFAULT_FORM,
  ENV_PORTAL,
  ENV_REGION,
  ENV_VAR,
  patchStoredSettings,
  publicSettings,
  resolveAccount,
  resolveApiKey,
  resolvePolicy,
} from "../settings";

function makeStrapi({
  stored = {},
  config = {},
  onSet,
}: {
  stored?: Record<string, unknown>;
  config?: Record<string, unknown>;
  onSet?: (value: unknown) => void;
} = {}) {
  return {
    store: () => ({
      get: async () => stored,
      set: async ({ value }: { value: unknown }) => onSet?.(value),
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

describe("resolvePolicy", () => {
  it("defaults to auto submit, leftover CRM writes on, HubSpot form mutation off", async () => {
    await expect(resolvePolicy(makeStrapi())).resolves.toEqual({
      submissionMode: "auto",
      writeExtraProperties: true,
      syncFieldsOnPublish: false,
      timelineNote: true,
    });
  });

  it("lets the settings UI override config/plugins.ts", async () => {
    const strapi = makeStrapi({
      stored: {
        submissionMode: "crm",
        writeExtraProperties: false,
        syncFieldsOnPublish: true,
        timelineNote: false,
      },
      config: {
        forms: { submissionMode: "forms", writeExtraProperties: true, syncFieldsOnPublish: false, timelineNote: true },
      },
    });
    await expect(resolvePolicy(strapi)).resolves.toEqual({
      submissionMode: "crm",
      writeExtraProperties: false,
      syncFieldsOnPublish: true,
      timelineNote: false,
    });
  });

  it("ignores an unknown submission mode and falls through", async () => {
    const strapi = makeStrapi({
      stored: { submissionMode: "magic" },
      config: { forms: { submissionMode: "forms" } },
    });
    await expect(resolvePolicy(strapi)).resolves.toMatchObject({ submissionMode: "forms" });
  });

  it("exposes the resolved policy on public settings", async () => {
    const pub = await publicSettings(
      makeStrapi({ stored: { submissionMode: "forms", syncFieldsOnPublish: true } }),
    );
    expect(pub.submissionMode).toBe("forms");
    expect(pub.writeExtraProperties).toBe(true);
    expect(pub.syncFieldsOnPublish).toBe(true);
  });
});

describe("patchStoredSettings", () => {
  it("merges policy flags without dropping the saved key", async () => {
    let saved: unknown;
    const strapi = makeStrapi({
      stored: { apiKey: "keep-me", portalId: "1" },
      onSet: (value) => {
        saved = value;
      },
    });
    await patchStoredSettings(strapi, {
      submissionMode: "crm",
      writeExtraProperties: false,
      syncFieldsOnPublish: true,
      timelineNote: false,
    });
    expect(saved).toMatchObject({
      apiKey: "keep-me",
      portalId: "1",
      submissionMode: "crm",
      writeExtraProperties: false,
      syncFieldsOnPublish: true,
      timelineNote: false,
    });
  });
});
