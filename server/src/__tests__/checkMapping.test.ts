import { describe, expect, it } from "vitest";
import {
  checkMapping,
  describeProblem,
  resolveObjects,
  STANDARD_OBJECTS,
  type HsProperty,
} from "../properties";

const properties: HsProperty[] = [
  { name: "firstname", label: "First name", object: "contact", type: "string", options: [] },
  { name: "name", label: "Name", object: "company", type: "string", options: [] },
  {
    name: "hs_role",
    label: "Rôle",
    object: "contact",
    type: "enumeration",
    options: [{ value: "dev", label: "Développeur" }, { value: "designer" }],
  },
  {
    name: "hs_tags",
    label: "Tags",
    object: "contact",
    type: "enumeration",
    options: [],
  },
];

describe("checkMapping", () => {
  it("accepts a property that exists on the mapped object", () => {
    expect(checkMapping(properties, { object: "contact", property: "firstname" })).toBeNull();
  });

  it("accepts an empty property — nothing to send, nothing to check", () => {
    expect(checkMapping(properties, { object: "contact", property: "" })).toBeNull();
    expect(checkMapping(properties, { object: "contact", property: "   " })).toBeNull();
  });

  it("flags a property unknown to the portal", () => {
    expect(checkMapping(properties, { object: "contact", property: "hs_rôle" })).toEqual({
      code: "unknown",
      property: "hs_rôle",
      object: "contact",
    });
  });

  it("flags a property that lives on another object", () => {
    expect(checkMapping(properties, { object: "contact", property: "name" })).toEqual({
      code: "wrong-object",
      property: "name",
      object: "contact",
      actualObject: "company",
    });
  });

  it("flags surrounding whitespace on an otherwise valid property", () => {
    expect(checkMapping(properties, { object: "contact", property: "firstname " })).toEqual({
      code: "whitespace",
      property: "firstname ",
      object: "contact",
    });
  });

  it("flags values outside an enumeration", () => {
    expect(
      checkMapping(properties, {
        object: "contact",
        property: "hs_role",
        values: ["dev", "cto"],
      }),
    ).toEqual({ code: "bad-option", property: "hs_role", object: "contact", values: ["cto"] });
  });

  it("accepts values inside the enumeration", () => {
    expect(
      checkMapping(properties, {
        object: "contact",
        property: "hs_role",
        values: ["dev", "designer"],
      }),
    ).toBeNull();
  });

  it("skips the option check when the enumeration declares no options", () => {
    expect(
      checkMapping(properties, { object: "contact", property: "hs_tags", values: ["anything"] }),
    ).toBeNull();
  });

  it("skips the option check on non-enumeration properties", () => {
    expect(
      checkMapping(properties, { object: "contact", property: "firstname", values: ["x"] }),
    ).toBeNull();
  });
});

describe("describeProblem", () => {
  it("renders every code as a sentence naming the property", () => {
    expect(
      describeProblem({ code: "unknown", property: "hs_rôle", object: "contact" }),
    ).toContain("hs_rôle");
    expect(
      describeProblem({
        code: "wrong-object",
        property: "name",
        object: "contact",
        actualObject: "company",
      }),
    ).toMatch(/company.*contact/);
    expect(
      describeProblem({ code: "whitespace", property: "role ", object: "contact" }),
    ).toContain("whitespace");
    expect(
      describeProblem({ code: "bad-option", property: "hs_role", object: "contact", values: ["cto"] }),
    ).toContain('"cto"');
  });
});

describe("resolveObjects", () => {
  it("defaults to contact and company", () => {
    expect(resolveObjects(undefined).map((o) => o.name)).toEqual(["contact", "company"]);
    expect(resolveObjects([]).map((o) => o.name)).toEqual(["contact", "company"]);
  });

  it("resolves standard names to their URL path", () => {
    expect(resolveObjects(["deal", "line_item"])).toEqual([
      { name: "deal", path: "deals" },
      { name: "line_item", path: "line_items" },
    ]);
  });

  it("accepts a standard object by its path too", () => {
    expect(resolveObjects(["companies"])).toEqual([{ name: "company", path: "companies" }]);
  });

  it("treats an unknown string as a custom object type id", () => {
    expect(resolveObjects(["2-12345"])).toEqual([{ name: "2-12345", path: "2-12345" }]);
  });

  it("accepts { name, path } definitions, defaulting path to name", () => {
    expect(resolveObjects([{ name: "cours", path: "2-999" }, { name: "p_x" }])).toEqual([
      { name: "cours", path: "2-999" },
      { name: "p_x", path: "p_x" },
    ]);
  });

  it("covers every standard object", () => {
    for (const def of STANDARD_OBJECTS) {
      expect(resolveObjects([def.name])).toEqual([def]);
    }
  });
});
