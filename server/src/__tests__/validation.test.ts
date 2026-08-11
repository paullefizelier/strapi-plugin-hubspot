import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "@strapi/strapi";
import { errors } from "@strapi/utils";
import { clearCache } from "../properties";
import { collectMappings, makeValidationMiddleware, type ValidateTarget } from "../validation";

const target: ValidateTarget = {
  uid: "api::form.form",
  objectField: "hsObject",
  propertyField: "hsProperty",
};

describe("collectMappings", () => {
  it("finds mappings at any depth — steps, repeatables, dynamic zones", () => {
    const data = {
      title: "Contact us",
      blocks: [
        {
          __component: "blocks.form",
          steps: [
            {
              fields: [
                { hsObject: "contact", hsProperty: "firstname" },
                { hsObject: "company", hsProperty: "name" },
              ],
            },
          ],
        },
      ],
    };

    expect(collectMappings(data, target)).toEqual([
      { object: "contact", property: "firstname", values: undefined },
      { object: "company", property: "name", values: undefined },
    ]);
  });

  it("defaults a missing object to contact", () => {
    expect(collectMappings({ hsProperty: "firstname" }, target)).toEqual([
      { object: "contact", property: "firstname", values: undefined },
    ]);
  });

  it("ignores empty and non-string properties", () => {
    expect(collectMappings({ hsProperty: "" }, target)).toEqual([]);
    expect(collectMappings({ hsProperty: "   " }, target)).toEqual([]);
    expect(collectMappings({ hsProperty: 42 }, target)).toEqual([]);
    expect(collectMappings(null, target)).toEqual([]);
  });

  it("collects option values, preferring value over label, trimmed", () => {
    const data = {
      hsObject: "contact",
      hsProperty: "hs_role",
      options: [
        { value: "dev", label: "Développeur" },
        { label: " designer " },
        { value: "", label: "" },
        null,
      ],
    };

    expect(collectMappings(data, target)).toEqual([
      { object: "contact", property: "hs_role", values: ["dev", "designer"] },
    ]);
  });

  it("reads the configured optionsField instead of the default", () => {
    const data = { hsProperty: "hs_role", choices: [{ value: "dev" }], options: [{ value: "x" }] };

    expect(collectMappings(data, { ...target, optionsField: "choices" })).toEqual([
      { object: "contact", property: "hs_role", values: ["dev"] },
    ]);
  });
});

/**
 * The middleware needs three things from strapi: the stored API key, the
 * plugin config, and a logger. Everything else comes from the mocked fetch.
 */
function makeStrapi({ apiKey = "key" }: { apiKey?: string } = {}) {
  return {
    store: () => ({ get: async () => (apiKey ? { apiKey } : {}) }),
    plugin: () => ({ config: (key: string, def: unknown) => (key === "objects" ? ["contact", "company"] : def) }),
    log: { warn: vi.fn(), error: vi.fn() },
  } as unknown as Core.Strapi;
}

function mockPortal() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      const bodies: Record<string, unknown> = {
        "/crm/v3/properties/contacts": {
          results: [
            { name: "firstname", label: "First name", type: "string" },
            {
              name: "hs_role",
              label: "Rôle",
              type: "enumeration",
              options: [{ value: "dev" }],
            },
          ],
        },
        "/crm/v3/properties/companies": {
          results: [{ name: "name", label: "Name", type: "string" }],
        },
        "/account-info/v3/details": {},
      };
      const body = bodies[path];
      return { ok: Boolean(body), status: body ? 200 : 404, json: async () => body ?? {} };
    }),
  );
}

const write = (data: unknown) => ({
  action: "create",
  uid: target.uid,
  params: { data },
});

beforeEach(() => {
  clearCache();
  mockPortal();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("makeValidationMiddleware", () => {
  it("lets a valid mapping through", async () => {
    const middleware = makeValidationMiddleware(makeStrapi(), target);
    const next = vi.fn(async () => "saved");

    await expect(middleware(write({ hsObject: "contact", hsProperty: "firstname" }), next))
      .resolves.toBe("saved");
    expect(next).toHaveBeenCalled();
  });

  it("ignores reads and other content types", async () => {
    const middleware = makeValidationMiddleware(makeStrapi(), target);
    const next = vi.fn(async () => "ok");

    await middleware({ action: "findOne", uid: target.uid, params: {} }, next);
    await middleware({ ...write({ hsProperty: "nope" }), uid: "api::other.other" }, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("blocks an unknown property by default (strict)", async () => {
    const middleware = makeValidationMiddleware(makeStrapi(), target);
    const next = vi.fn(async () => "saved");

    const call = middleware(write({ hsObject: "contact", hsProperty: "hs_rôle" }), next);
    await expect(call).rejects.toBeInstanceOf(errors.ValidationError);
    expect(next).not.toHaveBeenCalled();
  });

  it("carries structured problems in the error details", async () => {
    const middleware = makeValidationMiddleware(makeStrapi(), target);

    const err = await middleware(write({ hsObject: "contact", hsProperty: "name" }), async () => {})
      .then(() => null, (e: errors.ValidationError) => e);

    expect(err?.details).toEqual({
      problems: [
        { code: "wrong-object", property: "name", object: "contact", actualObject: "company" },
      ],
    });
  });

  it("lets an unknown property through with a warning when strict is false", async () => {
    const strapi = makeStrapi();
    const middleware = makeValidationMiddleware(strapi, { ...target, strict: false });
    const next = vi.fn(async () => "saved");

    await expect(middleware(write({ hsObject: "contact", hsProperty: "hs_staged" }), next))
      .resolves.toBe("saved");
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining("hs_staged"));
  });

  it("still blocks wrong-object, whitespace and bad-option when strict is false", async () => {
    const middleware = makeValidationMiddleware(makeStrapi(), { ...target, strict: false });
    const next = vi.fn(async () => "saved");

    for (const data of [
      { hsObject: "contact", hsProperty: "name" }, // wrong-object
      { hsObject: "contact", hsProperty: "firstname " }, // whitespace
      { hsObject: "contact", hsProperty: "hs_role", options: [{ value: "cto" }] }, // bad-option
    ]) {
      await expect(middleware(write(data), next)).rejects.toBeInstanceOf(errors.ValidationError);
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("never blocks when no API key is configured", async () => {
    const middleware = makeValidationMiddleware(makeStrapi({ apiKey: "" }), target);
    const next = vi.fn(async () => "saved");

    await expect(middleware(write({ hsObject: "contact", hsProperty: "typo" }), next))
      .resolves.toBe("saved");
  });

  it("never blocks when HubSpot is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: "down" }),
    })));
    const strapi = makeStrapi();
    const middleware = makeValidationMiddleware(strapi, target);
    const next = vi.fn(async () => "saved");

    await expect(middleware(write({ hsObject: "contact", hsProperty: "typo" }), next))
      .resolves.toBe("saved");
    expect(strapi.log.warn).toHaveBeenCalledWith(expect.stringContaining("validation skipped"));
  });
});
