import { describe, expect, it } from "vitest";
import type { FormDefinition } from "../conditions";
import { corporateDomain, findEmail, groupByObject, publicForm, sanitizeRawValues } from "../forms";

const definition: FormDefinition = {
  version: 1,
  steps: [
    {
      id: "stp_1",
      title: "Vous",
      fields: [
        {
          id: "fld_email",
          name: "email",
          label: "Email",
          type: "email",
          required: true,
          hubspot: { object: "contact", property: "email" },
        },
        {
          id: "fld_role",
          name: "role",
          label: "Rôle",
          type: "select",
          options: [{ value: "dev", label: "Dev" }],
          hubspot: { object: "contact", property: "hs_role" },
        },
        // No mapping at all: falls back to contact + the field name.
        { id: "fld_note", name: "comment", label: "Commentaire", type: "textarea" },
      ],
    },
    {
      id: "stp_2",
      visibleIf: { logic: "and", rules: [{ field: "fld_role", operator: "notEmpty" }] },
      fields: [
        {
          id: "fld_size",
          name: "size",
          label: "Effectif",
          type: "number",
          hubspot: { object: "company", property: "numberofemployees" },
        },
      ],
    },
  ],
};

describe("publicForm", () => {
  const entry = {
    name: "Qualification B2B",
    slug: "qualification-b2b",
    title: "Parlons-en",
    subtitle: null,
    nextLabel: "Suivant",
    submitLabel: "Envoyer",
    successMessage: "Merci !",
    locale: "fr",
    definition,
  };

  it("keeps the meta and structure the renderer needs", () => {
    const out = publicForm(entry);
    expect(out.slug).toBe("qualification-b2b");
    expect(out.title).toBe("Parlons-en");
    expect(out.steps).toHaveLength(2);
    expect(out.steps[1].visibleIf).toEqual(definition.steps[1].visibleIf);
    expect(out.steps[0].fields[1]).toMatchObject({
      id: "fld_role",
      name: "role",
      type: "select",
      options: [{ value: "dev", label: "Dev" }],
    });
  });

  it("strips the CRM mapping — the browser has no business knowing it", () => {
    const out = publicForm(entry);
    for (const step of out.steps) {
      for (const fld of step.fields) {
        expect(fld).not.toHaveProperty("hubspot");
      }
    }
  });

  it("does not leak the internal name or the definition version", () => {
    const out = publicForm(entry) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty("name");
    expect(out).not.toHaveProperty("definition");
  });
});

describe("groupByObject", () => {
  it("routes each value to its mapped object under its CRM property name", () => {
    const groups = groupByObject(definition, {
      email: "jane@acme.com",
      role: "dev",
      size: 12,
    });
    expect(groups).toEqual({
      contact: { email: "jane@acme.com", hs_role: "dev" },
      company: { numberofemployees: 12 },
    });
  });

  it("defaults to contact + the field name when a field has no mapping", () => {
    const groups = groupByObject(definition, { comment: "hello" });
    expect(groups).toEqual({ contact: { comment: "hello" } });
  });

  it("only groups submitted values — an absent field writes nothing", () => {
    expect(groupByObject(definition, {})).toEqual({});
  });
});

describe("findEmail", () => {
  it("prefers the field literally named email", () => {
    expect(findEmail({ contact: "x@y.co", email: "Jane@Acme.com " })).toBe("jane@acme.com");
  });

  it("falls back to the first email-looking value", () => {
    expect(findEmail({ name: "Jane", contact: "jane@acme.com" })).toBe("jane@acme.com");
  });

  it("returns undefined when nothing looks like an email", () => {
    expect(findEmail({ name: "Jane", phone: "0600000000" })).toBeUndefined();
  });
});

describe("corporateDomain", () => {
  it("returns the domain of a corporate address", () => {
    expect(corporateDomain("jane@acme.com")).toBe("acme.com");
  });

  it("refuses free-mail providers — a personal address is not a company", () => {
    expect(corporateDomain("jane@gmail.com")).toBeUndefined();
    expect(corporateDomain("jane@orange.fr")).toBeUndefined();
  });

  it("returns undefined without an email", () => {
    expect(corporateDomain(undefined)).toBeUndefined();
  });
});

describe("sanitizeRawValues", () => {
  it("accepts a flat bag of primitives", () => {
    expect(sanitizeRawValues({ email: "a@b.co", ok: true, n: 3 })).toEqual({
      email: "a@b.co",
      ok: true,
      n: 3,
    });
  });

  it("refuses anything that is not a plain object of primitives", () => {
    expect(sanitizeRawValues(null)).toBeNull();
    expect(sanitizeRawValues("x")).toBeNull();
    expect(sanitizeRawValues([1, 2])).toBeNull();
    expect(sanitizeRawValues({ nested: { a: 1 } })).toEqual({});
  });

  it("refuses a bag with too many fields", () => {
    const big = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, "v"]));
    expect(sanitizeRawValues(big)).toBeNull();
  });

  it("clips oversized string values instead of refusing the submission", () => {
    const out = sanitizeRawValues({ comment: "x".repeat(6000) });
    expect((out?.comment as string).length).toBe(5000);
  });
});
