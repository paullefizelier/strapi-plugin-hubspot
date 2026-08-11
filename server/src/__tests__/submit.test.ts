import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "@strapi/strapi";
import { clearCache } from "../properties";
import { createSubmitService } from "../submit";

/**
 * The service touches three externals: the API key (store), the portal schema
 * (fetch, for pre-validation) and the upsert endpoint (fetch). Failures are
 * parked through `strapi.documents`, mocked as an in-memory array.
 */

const schemaBodies: Record<string, unknown> = {
  "/crm/v3/properties/contacts": {
    results: [
      { name: "email", label: "Email", type: "string" },
      { name: "firstname", label: "First name", type: "string" },
      { name: "numberofemployees", label: "Employees", type: "number" },
      { name: "comment", label: "Comment", type: "string" },
      { name: "note", label: "Note", type: "string" },
      {
        name: "hs_role",
        label: "Rôle",
        type: "enumeration",
        options: [{ value: "dev" }, { value: "designer" }],
      },
    ],
  },
  "/crm/v3/properties/companies": { results: [] },
  "/account-info/v3/details": {},
};

interface UpsertCall {
  url: string;
  body: { inputs: { idProperty: string; id: string; properties: Record<string, string> }[] };
}

function mockFetch({
  upsert = () => ({ status: 200, body: { results: [{ id: "hs-1" }] } }),
}: {
  upsert?: (call: UpsertCall, attempt: number) => { status: number; body: unknown };
} = {}) {
  let attempts = 0;
  const calls: UpsertCall[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: { body?: string }) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/batch/upsert")) {
      attempts += 1;
      const call = { url: path, body: JSON.parse(init?.body ?? "{}") };
      calls.push(call);
      const res = upsert(call, attempts);
      return { ok: res.status < 400, status: res.status, json: async () => res.body };
    }
    const body = schemaBodies[path];
    return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body ?? {} };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, upsertAttempts: () => attempts };
}

function makeStrapi({ apiKey = "key" } = {}) {
  const failures: Record<string, unknown>[] = [];
  let seq = 0;
  const documents = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { documentId: `f-${(seq += 1)}`, attempts: 1, ...data };
      failures.push(row);
      return row;
    }),
    findMany: vi.fn(async () => [...failures]),
    delete: vi.fn(async ({ documentId }: { documentId: string }) => {
      const i = failures.findIndex((f) => f.documentId === documentId);
      if (i >= 0) failures.splice(i, 1);
    }),
    update: vi.fn(async ({ documentId, data }: { documentId: string; data: object }) => {
      const row = failures.find((f) => f.documentId === documentId);
      if (row) Object.assign(row, data);
    }),
    count: vi.fn(async () => failures.length),
  };
  const strapi = {
    store: () => ({ get: async () => (apiKey ? { apiKey } : {}) }),
    plugin: () => ({ config: (key: string, def: unknown) => (key === "objects" ? ["contact", "company"] : def) }),
    documents: () => documents,
    log: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;
  return { strapi, failures, documents };
}

const service = (strapi: Core.Strapi) =>
  createSubmitService(strapi, { sleep: async () => {} });

const input = {
  object: "contact",
  idProperty: "email",
  properties: { email: "jane@acme.com", firstname: "Jane", hs_role: "dev" },
};

beforeEach(() => clearCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("upsert", () => {
  it("upserts through HubSpot's batch endpoint and returns the record id", async () => {
    const { strapi } = makeStrapi();
    const { calls } = mockFetch();

    const result = await service(strapi).upsert(input);

    expect(result).toEqual({ ok: true, id: "hs-1" });
    expect(calls[0].url).toBe("/crm/v3/objects/contacts/batch/upsert");
    expect(calls[0].body.inputs).toEqual([
      {
        idProperty: "email",
        id: "jane@acme.com",
        properties: { email: "jane@acme.com", firstname: "Jane", hs_role: "dev" },
      },
    ]);
  });

  it("coerces values to strings and drops the empty ones", async () => {
    const { strapi } = makeStrapi();
    const { calls } = mockFetch();

    await service(strapi).upsert({
      ...input,
      properties: { email: "jane@acme.com", numberofemployees: 42, comment: "", note: null },
    });

    expect(calls[0].body.inputs[0].properties).toEqual({
      email: "jane@acme.com",
      numberofemployees: "42",
    });
  });

  it("refuses a payload the portal would reject, without sending it", async () => {
    const { strapi } = makeStrapi();
    const { upsertAttempts } = mockFetch();

    const result = await service(strapi).upsert({
      ...input,
      properties: { email: "jane@acme.com", hs_rôle: "dev" },
    });

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      { code: "unknown", property: "hs_rôle", object: "contact" },
    ]);
    expect(upsertAttempts()).toBe(0);
  });

  it("checks enumeration values, splitting multi-select on semicolons", async () => {
    const { strapi } = makeStrapi();
    mockFetch();

    const okMulti = await service(strapi).upsert({
      ...input,
      properties: { email: "jane@acme.com", hs_role: "dev;designer" },
    });
    expect(okMulti.ok).toBe(true);

    clearCache();
    const bad = await service(strapi).upsert({
      ...input,
      properties: { email: "jane@acme.com", hs_role: "dev;cto" },
    });
    expect(bad.problems).toEqual([
      { code: "bad-option", property: "hs_role", object: "contact", values: ["cto"] },
    ]);
  });

  it("fails without an API key or without a value for idProperty", async () => {
    mockFetch();
    const noKey = await service(makeStrapi({ apiKey: "" }).strapi).upsert(input);
    expect(noKey).toMatchObject({ ok: false, error: expect.stringContaining("API key") });

    const { strapi } = makeStrapi();
    const noId = await service(strapi).upsert({ ...input, properties: { firstname: "Jane" } });
    expect(noId).toMatchObject({ ok: false, error: expect.stringContaining("email") });
  });

  it("retries transient failures and succeeds", async () => {
    const { strapi } = makeStrapi();
    const { upsertAttempts } = mockFetch({
      upsert: (_call, attempt) =>
        attempt < 3
          ? { status: 429, body: { message: "rate limited" } }
          : { status: 200, body: { results: [{ id: "hs-1" }] } },
    });

    const result = await service(strapi).upsert(input);

    expect(result).toEqual({ ok: true, id: "hs-1" });
    expect(upsertAttempts()).toBe(3);
  });

  it("queues the payload after exhausting retries on transient failures", async () => {
    const { strapi, failures } = makeStrapi();
    const { upsertAttempts } = mockFetch({
      upsert: () => ({ status: 503, body: { message: "down" } }),
    });

    const result = await service(strapi).upsert(input);

    expect(result).toMatchObject({ ok: false, queued: true, error: "down" });
    expect(upsertAttempts()).toBe(3);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ object: "contact", properties: input.properties });
  });

  it("does not queue a permanent refusal — retrying cannot fix a 400", async () => {
    const { strapi, failures } = makeStrapi();
    const { upsertAttempts } = mockFetch({
      upsert: () => ({ status: 400, body: { message: "Property values were not valid" } }),
    });

    const result = await service(strapi).upsert(input);

    expect(result).toMatchObject({ ok: false, error: "Property values were not valid" });
    expect(result.queued).toBeUndefined();
    expect(upsertAttempts()).toBe(1);
    expect(failures).toHaveLength(0);
  });
});

describe("retryFailures", () => {
  it("replays parked submissions, deleting the ones that succeed", async () => {
    const { strapi, failures, documents } = makeStrapi();
    mockFetch({ upsert: () => ({ status: 503, body: { message: "down" } }) });
    await service(strapi).upsert(input);
    expect(failures).toHaveLength(1);

    clearCache();
    mockFetch();
    const summary = await service(strapi).retryFailures();

    expect(summary).toEqual({ retried: 1, succeeded: 1, failed: 0 });
    expect(failures).toHaveLength(0);
    expect(documents.delete).toHaveBeenCalled();
  });

  it("keeps a still-failing row, bumping its attempt count", async () => {
    const { strapi, failures } = makeStrapi();
    mockFetch({ upsert: () => ({ status: 503, body: { message: "down" } }) });
    await service(strapi).upsert(input);

    const summary = await service(strapi).retryFailures();

    expect(summary).toEqual({ retried: 1, succeeded: 0, failed: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ attempts: 2, error: "down" });
  });
});
