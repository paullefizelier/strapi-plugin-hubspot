import { describe, expect, it, vi } from "vitest";
import type { Core } from "@strapi/strapi";
import { buildPopulate, entryLabel, runAudit } from "../audit";
import type { Schema } from "../properties";
import type { ValidateTarget } from "../validation";

const target: ValidateTarget = {
  uid: "api::form.form",
  objectField: "hsObject",
  propertyField: "hsProperty",
};

const portalSchema: Schema = {
  properties: [
    { name: "firstname", label: "First name", object: "contact", type: "string", options: [] },
    { name: "name", label: "Name", object: "company", type: "string", options: [] },
  ],
  objects: ["contact", "company"],
  unavailable: [],
};

describe("buildPopulate", () => {
  const components = {
    "form.field": {
      attributes: {
        hsProperty: { type: "string" },
        options: { type: "component", component: "form.option" },
      },
    },
    "form.option": {
      attributes: { value: { type: "string" }, label: { type: "string" } },
    },
    "blocks.form": {
      attributes: {
        fields: { type: "component", component: "form.field" },
      },
    },
    "blocks.hero": {
      attributes: { title: { type: "string" } },
    },
  };

  it("follows components and dynamic zones to any depth", () => {
    const contentType = {
      attributes: {
        title: { type: "string" },
        blocks: { type: "dynamiczone", components: ["blocks.form", "blocks.hero"] },
        footerField: { type: "component", component: "form.field" },
      },
    };

    expect(buildPopulate(components, contentType)).toEqual({
      blocks: {
        on: {
          "blocks.form": {
            populate: { fields: { populate: { options: { populate: "*" } } } },
          },
          "blocks.hero": { populate: "*" },
        },
      },
      footerField: { populate: { options: { populate: "*" } } },
    });
  });

  it("returns nothing for a flat schema — no populate needed", () => {
    expect(buildPopulate(components, { attributes: { title: { type: "string" } } })).toEqual({});
  });

  it("ignores relations and media", () => {
    const contentType = {
      attributes: {
        cover: { type: "media" },
        author: { type: "relation" },
      },
    };
    expect(buildPopulate(components, contentType)).toEqual({});
  });
});

describe("entryLabel", () => {
  it("prefers a human field over the documentId", () => {
    expect(entryLabel({ documentId: "abc", title: "Contact us" })).toBe("Contact us");
    expect(entryLabel({ documentId: "abc", name: "Footer form" })).toBe("Footer form");
  });

  it("falls back to the documentId", () => {
    expect(entryLabel({ documentId: "abc", title: "  " })).toBe("abc");
    expect(entryLabel({ documentId: "abc" })).toBe("abc");
  });
});

/** A strapi mock exposing content types, components, i18n locales and documents. */
function makeStrapi({
  contentType,
  docsByLocale,
  locales,
}: {
  contentType: unknown;
  docsByLocale: Record<string, unknown[]>;
  locales?: string[];
}) {
  const findMany = vi.fn(async (params: { locale?: string }) => {
    return docsByLocale[params.locale ?? "default"] ?? [];
  });
  return {
    strapi: {
      contentType: () => contentType,
      components: {},
      plugin: (name: string) =>
        name === "i18n"
          ? { service: () => ({ find: async () => (locales ?? []).map((code) => ({ code })) }) }
          : { config: () => [] },
      documents: () => ({ findMany }),
      log: { warn: vi.fn(), error: vi.fn() },
    } as unknown as Core.Strapi,
    findMany,
  };
}

describe("runAudit", () => {
  it("reports invalid mappings per entry, with counts", async () => {
    const { strapi } = makeStrapi({
      contentType: { attributes: {}, options: { draftAndPublish: true } },
      docsByLocale: {
        default: [
          {
            documentId: "ok-1",
            title: "Valid form",
            fields: [{ hsObject: "contact", hsProperty: "firstname" }],
          },
          {
            documentId: "bad-1",
            title: "Broken form",
            fields: [
              { hsObject: "contact", hsProperty: "firstname" },
              { hsObject: "contact", hsProperty: "hs_deleted" },
            ],
          },
        ],
      },
    });

    const reports = await runAudit(strapi, [target], portalSchema);

    expect(reports).toEqual([
      {
        uid: target.uid,
        entries: 2,
        mappings: 3,
        invalid: [
          {
            documentId: "bad-1",
            locale: undefined,
            label: "Broken form",
            problems: [{ code: "unknown", property: "hs_deleted", object: "contact" }],
          },
        ],
      },
    ]);
  });

  it("passes draft status only when draft & publish is on", async () => {
    const on = makeStrapi({
      contentType: { attributes: {}, options: { draftAndPublish: true } },
      docsByLocale: { default: [] },
    });
    const off = makeStrapi({
      contentType: { attributes: {}, options: { draftAndPublish: false } },
      docsByLocale: { default: [] },
    });

    await runAudit(on.strapi, [target], portalSchema);
    await runAudit(off.strapi, [target], portalSchema);

    expect(on.findMany).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(off.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ status: "draft" }));
  });

  it("scans every locale of a localized content type and tags the findings", async () => {
    const { strapi, findMany } = makeStrapi({
      contentType: {
        attributes: {},
        options: { draftAndPublish: true },
        pluginOptions: { i18n: { localized: true } },
      },
      locales: ["fr", "en"],
      docsByLocale: {
        fr: [{ documentId: "doc-1", title: "FR", fields: [{ hsObject: "contact", hsProperty: "typo" }] }],
        en: [{ documentId: "doc-1", title: "EN", fields: [{ hsObject: "contact", hsProperty: "firstname" }] }],
      },
    });

    const reports = await runAudit(strapi, [target], portalSchema);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(reports[0].entries).toBe(2);
    expect(reports[0].invalid).toEqual([
      {
        documentId: "doc-1",
        locale: "fr",
        label: "FR",
        problems: [{ code: "unknown", property: "typo", object: "contact" }],
      },
    ]);
  });

  it("reports a target whose content type is missing instead of failing the audit", async () => {
    const { strapi } = makeStrapi({ contentType: undefined, docsByLocale: {} });

    const reports = await runAudit(strapi, [target], portalSchema);

    expect(reports[0]).toMatchObject({
      uid: target.uid,
      entries: 0,
      error: expect.stringContaining(target.uid),
    });
  });

  it("reports a target whose entries can't be fetched instead of failing the audit", async () => {
    const { strapi } = makeStrapi({
      contentType: { attributes: {} },
      docsByLocale: {},
    });
    Object.assign(strapi, {
      documents: () => ({
        findMany: async () => {
          throw new Error("db exploded");
        },
      }),
    });

    const reports = await runAudit(strapi, [target], portalSchema);

    expect(reports[0]).toMatchObject({ uid: target.uid, entries: 0, error: "db exploded" });
  });
});
