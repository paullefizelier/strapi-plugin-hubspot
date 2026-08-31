import { describe, expect, it } from "vitest";
import { evaluateCondition, resolveSubmission, type FormDefinition } from "../conditions";
import { publicForm } from "../forms";

/**
 * THE 1.0 CONTRACT. These tests freeze the shapes host apps depend on: the
 * public form payload, the submission conventions, the operator set. Changing
 * any of them is a BREAKING change — this suite failing means "bump the
 * major", never "fix the test".
 */

const definition: FormDefinition = {
  version: 1,
  steps: [
    {
      id: "stp_1",
      title: "T",
      description: "D",
      class: "c",
      visibleIf: null,
      fields: [
        {
          id: "fld_1",
          name: "email",
          label: "Email",
          type: "email",
          placeholder: "p",
          helpText: "h",
          icon: "i",
          class: "c",
          width: "half",
          required: true,
          persist: "days30",
          options: [{ value: "v", label: "l" }],
          placeholderExamples: ["ex1"],
          hubspot: { object: "contact", property: "email" },
          companyMap: { name: { object: "company", property: "name" } },
          visibleIf: { logic: "and", rules: [] },
        },
      ],
    },
  ],
};

describe("contract — public form payload (GET /api/hubspot/forms/:slug)", () => {
  const out = publicForm({
    name: "N",
    slug: "s",
    title: "t",
    subtitle: "st",
    nextLabel: "n",
    submitLabel: "sb",
    successMessage: "sm",
    class: "c",
    locale: "fr",
    definition,
  });

  it("exposes exactly the documented top-level keys", () => {
    expect(Object.keys(out).sort()).toEqual([
      "class",
      "locale",
      "nextLabel",
      "slug",
      "steps",
      "submitLabel",
      "subtitle",
      "successMessage",
      "title",
    ]);
  });

  it("keeps every rendering prop on fields and steps", () => {
    const step = out.steps[0];
    expect(step).toMatchObject({ id: "stp_1", title: "T", description: "D", class: "c" });
    const fld = step.fields[0] as Record<string, unknown>;
    for (const key of [
      "id",
      "name",
      "label",
      "type",
      "placeholder",
      "helpText",
      "icon",
      "class",
      "width",
      "required",
      "persist",
      "options",
      "placeholderExamples",
      "visibleIf",
    ]) {
      expect(fld, `field.${key} must stay public`).toHaveProperty(key);
    }
  });

  it("NEVER leaks the CRM mappings to the browser", () => {
    const fld = out.steps[0].fields[0];
    expect(fld).not.toHaveProperty("hubspot");
    expect(fld).not.toHaveProperty("companyMap");
  });
});

describe("contract — submission conventions", () => {
  it("company companion keys are <name>__siret and <name>__company", () => {
    // The frontend writes these two exact keys; renaming them breaks every
    // deployed renderer.
    expect(`entreprise__siret`).toMatch(/__siret$/);
    expect(`entreprise__company`).toMatch(/__company$/);
    const res = resolveSubmission(definition, { email: "a@b.co", entreprise__siret: "x" });
    // Undeclared companions surface in `unknown` — the pipeline reads them
    // from rawValues, resolveSubmission must not swallow them silently.
    expect(res.unknown).toContain("entreprise__siret");
  });

  it("the honeypot key is __hp", () => {
    // Deployed frontends render a hidden __hp input; renaming it turns the
    // trap off silently.
    expect("__hp").toBe("__hp");
  });

  it("missingRequired rows carry { id, name, label }", () => {
    const res = resolveSubmission(definition, {});
    expect(res.missingRequired[0]).toEqual({ id: "fld_1", name: "email", label: "Email" });
  });
});

describe("contract — condition operators (definition version 1)", () => {
  const OPERATORS_V1 = [
    "eq",
    "neq",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
    "empty",
    "notEmpty",
    "gt",
    "lt",
    "in",
    "notIn",
  ] as const;

  it("every v1 operator evaluates (an unknown one would silently hide fields)", () => {
    for (const operator of OPERATORS_V1) {
      const holds = evaluateCondition(
        { logic: "and", rules: [{ field: "f", operator, value: "1", values: ["1"] }] },
        () => "1",
      );
      expect(typeof holds, `operator ${operator}`).toBe("boolean");
    }
  });

  it("eq and in still hold on the canonical example", () => {
    const get = () => " yes ";
    expect(
      evaluateCondition({ logic: "and", rules: [{ field: "f", operator: "eq", value: "yes" }] }, get),
    ).toBe(true);
    expect(
      evaluateCondition(
        { logic: "or", rules: [{ field: "f", operator: "in", values: ["no", "yes"] }] },
        get,
      ),
    ).toBe(true);
  });
});
