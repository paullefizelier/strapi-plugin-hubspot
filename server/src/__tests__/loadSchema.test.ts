import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "@strapi/strapi";
import { clearCache, loadSchema, resolveObjects } from "../properties";

/**
 * `loadSchema` hits two HubSpot endpoints: `/crm/v3/properties/<path>` per
 * object and `/account-info/v3/details` once. The mock routes by URL so each
 * test declares what the portal looks like.
 */

const strapi = {
  log: { warn: vi.fn(), error: vi.fn() },
} as unknown as Core.Strapi;

type Responses = Record<string, { status: number; body: unknown }>;

function mockHubspot(responses: Responses) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const path = new URL(String(url)).pathname;
    const match = responses[path] ?? { status: 404, body: { message: `no mock for ${path}` } };
    return {
      ok: match.status < 400,
      status: match.status,
      json: async () => match.body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const contactProps = {
  results: [
    { name: "zz_last", label: "ZZ", type: "string" },
    { name: "firstname", label: "First name", type: "string" },
    {
      name: "createdate",
      label: "Create date",
      type: "datetime",
      modificationMetadata: { readOnlyValue: true },
    },
    {
      name: "hs_role",
      label: "Rôle",
      type: "enumeration",
      groupName: "contactinformation",
      options: [{ value: "dev" }, { value: "designer" }],
    },
  ],
};

const companyProps = {
  results: [{ name: "name", label: "Name", type: "string" }],
};

const account = { portalId: 123456, uiDomain: "app-eu1.hubspot.com" };

const OBJECTS = resolveObjects(["contact", "company"]);

beforeEach(() => {
  clearCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("loadSchema", () => {
  it("returns writable properties sorted by object then label, with portal identity", async () => {
    mockHubspot({
      "/crm/v3/properties/contacts": { status: 200, body: contactProps },
      "/crm/v3/properties/companies": { status: 200, body: companyProps },
      "/account-info/v3/details": { status: 200, body: account },
    });

    const schema = await loadSchema(strapi, "key", OBJECTS);

    expect(schema.objects).toEqual(["contact", "company"]);
    expect(schema.unavailable).toEqual([]);
    expect(schema.portalId).toBe(123456);
    expect(schema.uiDomain).toBe("app-eu1.hubspot.com");
    // createdate is read-only — writing it always fails, so it is not offered.
    expect(schema.properties.map((p) => p.name)).toEqual([
      "name",
      "firstname",
      "hs_role",
      "zz_last",
    ]);
    expect(schema.properties.find((p) => p.name === "hs_role")).toMatchObject({
      object: "contact",
      options: ["dev", "designer"],
      group: "contactinformation",
    });
  });

  it("skips an unreadable object instead of failing the whole schema", async () => {
    mockHubspot({
      "/crm/v3/properties/contacts": { status: 200, body: contactProps },
      "/crm/v3/properties/companies": {
        status: 403,
        body: { message: "This app hasn't been granted all required scopes" },
      },
      "/account-info/v3/details": { status: 200, body: account },
    });

    const schema = await loadSchema(strapi, "key", OBJECTS);

    expect(schema.objects).toEqual(["contact"]);
    expect(schema.unavailable).toEqual([
      { object: "company", reason: "This app hasn't been granted all required scopes" },
    ]);
  });

  it("throws when no object at all is readable", async () => {
    mockHubspot({
      "/crm/v3/properties/contacts": { status: 401, body: { message: "Invalid token" } },
      "/crm/v3/properties/companies": { status: 401, body: { message: "Invalid token" } },
    });

    await expect(loadSchema(strapi, "bad-key", OBJECTS)).rejects.toThrow("Invalid token");
  });

  it("omits the portal identity when the account endpoint is refused", async () => {
    mockHubspot({
      "/crm/v3/properties/contacts": { status: 200, body: contactProps },
      "/crm/v3/properties/companies": { status: 200, body: companyProps },
      "/account-info/v3/details": { status: 403, body: { message: "missing oauth scope" } },
    });

    const schema = await loadSchema(strapi, "key", OBJECTS);

    expect(schema.portalId).toBeUndefined();
    expect(schema.uiDomain).toBeUndefined();
    expect(schema.properties.length).toBeGreaterThan(0);
  });

  it("serves the cache within the TTL and refetches on force", async () => {
    const fetchMock = mockHubspot({
      "/crm/v3/properties/contacts": { status: 200, body: contactProps },
      "/crm/v3/properties/companies": { status: 200, body: companyProps },
      "/account-info/v3/details": { status: 200, body: account },
    });

    await loadSchema(strapi, "key", OBJECTS);
    const afterFirst = fetchMock.mock.calls.length;

    await loadSchema(strapi, "key", OBJECTS);
    expect(fetchMock.mock.calls.length).toBe(afterFirst);

    await loadSchema(strapi, "key", OBJECTS, { force: true });
    expect(fetchMock.mock.calls.length).toBe(afterFirst * 2);
  });

  it("de-duplicates concurrent calls into one fetch round", async () => {
    const fetchMock = mockHubspot({
      "/crm/v3/properties/contacts": { status: 200, body: contactProps },
      "/crm/v3/properties/companies": { status: 200, body: companyProps },
      "/account-info/v3/details": { status: 200, body: account },
    });

    const [a, b] = await Promise.all([
      loadSchema(strapi, "key", OBJECTS),
      loadSchema(strapi, "key", OBJECTS),
    ]);

    expect(a).toBe(b);
    // 2 property endpoints + 1 account endpoint — once, not twice.
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it("drops the cache after clearCache", async () => {
    const fetchMock = mockHubspot({
      "/crm/v3/properties/contacts": { status: 200, body: contactProps },
      "/crm/v3/properties/companies": { status: 200, body: companyProps },
      "/account-info/v3/details": { status: 200, body: account },
    });

    await loadSchema(strapi, "key", OBJECTS);
    clearCache();
    await loadSchema(strapi, "key", OBJECTS);

    expect(fetchMock.mock.calls.length).toBe(6);
  });
});
