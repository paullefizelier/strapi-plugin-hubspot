import { describe, expect, it } from "vitest";
import type { FormDefinition } from "../conditions";
import {
  appendFieldGroups,
  hsFieldType,
  leftoverContactProps,
  mappedContactFields,
  missingMappedFields,
  missingRequiredHubspotFields,
  toHsFormField,
} from "../formSync";

const definition: FormDefinition = {
  version: 1,
  steps: [
    {
      id: "stp_1",
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
          id: "fld_first",
          name: "firstname",
          label: "Prénom",
          type: "text",
          hubspot: { object: "contact", property: "firstname" },
        },
        {
          id: "fld_city",
          name: "city",
          label: "Ville",
          type: "text",
          hubspot: { object: "contact", property: "city" },
        },
        {
          id: "fld_size",
          name: "size",
          label: "Effectif",
          type: "number",
          hubspot: { object: "company", property: "numberofemployees" },
        },
        {
          id: "fld_company",
          name: "company",
          type: "company",
        },
      ],
    },
  ],
};

describe("mappedContactFields", () => {
  it("lists contact mappings and skips company fields", () => {
    expect(mappedContactFields(definition).map((f) => f.property)).toEqual([
      "email",
      "firstname",
      "city",
    ]);
  });
});

describe("missingMappedFields", () => {
  it("returns only contact properties the HubSpot form does not already have", () => {
    expect(missingMappedFields(definition, ["email", "firstname"]).map((f) => f.property)).toEqual([
      "city",
    ]);
  });
});

describe("hsFieldType / toHsFormField", () => {
  it("translates builder types into HubSpot marketing field types", () => {
    expect(hsFieldType("email")).toBe("email");
    expect(hsFieldType("tel")).toBe("phone");
    expect(hsFieldType("textarea")).toBe("multi_line_text");
    expect(hsFieldType("select")).toBe("dropdown");
    expect(hsFieldType("radio")).toBe("radio");
    expect(hsFieldType("checkbox", [])).toBe("booleancheckbox");
    expect(hsFieldType("checkbox", [{ value: "a" }])).toBe("multiple_checkboxes");
    expect(hsFieldType("text")).toBe("single_line_text");
  });

  it("builds a contact field HubSpot can PATCH onto fieldGroups", () => {
    expect(
      toHsFormField({
        name: "city",
        label: "Ville",
        type: "text",
        required: true,
        object: "contact",
        property: "city",
      }),
    ).toEqual({
      objectTypeId: "0-1",
      name: "city",
      label: "Ville",
      required: true,
      hidden: false,
      fieldType: "single_line_text",
    });
  });
});

describe("appendFieldGroups", () => {
  it("keeps existing groups and appends one group per missing field", () => {
    const groups = appendFieldGroups(
      [{ fields: [{ name: "email" }] }],
      [
        {
          name: "city",
          label: "Ville",
          type: "text",
          property: "city",
          object: "contact",
        },
      ],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      groupType: "default_group",
      fields: [{ name: "email" }],
    });
    expect(groups[1]?.fields).toEqual([
      expect.objectContaining({ name: "city", fieldType: "single_line_text" }),
    ]);
  });
});

describe("missingRequiredHubspotFields", () => {
  it("lists HubSpot required fields the Strapi form does not collect", () => {
    const withCompany: FormDefinition = {
      version: 1,
      steps: [
        {
          id: "s",
          fields: [
            ...definition.steps[0]!.fields,
            {
              id: "fld_co",
              name: "entreprise",
              type: "company",
              companyMap: { name: { object: "company", property: "name" } },
            },
          ],
        },
      ],
    };
    expect(
      missingRequiredHubspotFields(withCompany, [
        { name: "email", objectTypeId: "0-1" },
        { name: "name", objectTypeId: "0-2" },
        { name: "genre", objectTypeId: "0-1" },
      ]),
    ).toEqual([{ name: "genre", objectTypeId: "0-1", object: "contact" }]);
  });
});

describe("leftoverContactProps", () => {
  it("keeps mapped contact properties that the Forms API did not send", () => {
    expect(
      leftoverContactProps(
        { email: "a@b.co", firstname: "Ada", city: "Lyon", hs_role: "dev" },
        ["email", "firstname"],
      ),
    ).toEqual({ city: "Lyon", hs_role: "dev" });
  });

  it("never re-sends email as a leftover", () => {
    expect(leftoverContactProps({ email: "a@b.co", city: "Lyon" }, [])).toEqual({ city: "Lyon" });
  });
});
