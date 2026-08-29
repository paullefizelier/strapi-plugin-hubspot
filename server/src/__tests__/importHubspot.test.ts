import { describe, expect, it } from "vitest";
import { convertHubspotForm, type RawHubspotForm } from "../importHubspot";

/** A realistic marketing v3 form, trimmed to what the converter reads. */
const raw: RawHubspotForm = {
  id: "abc-123",
  name: "Demande de démo",
  fieldGroups: [
    {
      fields: [
        {
          objectTypeId: "0-1",
          name: "firstname",
          label: "Prénom",
          fieldType: "single_line_text",
          required: true,
          placeholder: "Marie",
        },
        {
          objectTypeId: "0-1",
          name: "lastname",
          label: "Nom",
          fieldType: "single_line_text",
        },
      ],
    },
    {
      fields: [
        {
          objectTypeId: "0-1",
          name: "email",
          label: "Email",
          fieldType: "email",
          required: true,
          description: "Jamais partagé",
        },
      ],
    },
    {
      fields: [
        {
          objectTypeId: "0-2",
          name: "numberofemployees",
          label: "Effectif",
          fieldType: "dropdown",
          options: [
            { value: "1-10", label: "1 à 10" },
            { value: "11-50", label: "11 à 50" },
          ],
        },
      ],
    },
  ],
  displayOptions: { submitButtonText: "Envoyer" },
  configuration: { postSubmitAction: { type: "thank_you", value: "Merci !" } },
};

describe("convertHubspotForm", () => {
  it("maps fields, meta and the CRM mapping in one pass", () => {
    const out = convertHubspotForm(raw);
    expect(out.name).toBe("Demande de démo");
    expect(out.submitLabel).toBe("Envoyer");
    expect(out.successMessage).toBe("Merci !");
    expect(out.skipped).toEqual([]);
    expect(out.definition.version).toBe(1);
    expect(out.definition.steps).toHaveLength(1);

    const fields = out.definition.steps[0]!.fields;
    expect(fields.map((f) => f.name)).toEqual([
      "firstname",
      "lastname",
      "email",
      "numberofemployees",
    ]);
    expect(fields[0]).toMatchObject({
      label: "Prénom",
      type: "text",
      required: true,
      placeholder: "Marie",
      hubspot: { object: "contact", property: "firstname" },
    });
    expect(fields[2]).toMatchObject({ type: "email", helpText: "Jamais partagé" });
    expect(fields[3]).toMatchObject({
      type: "select",
      hubspot: { object: "company", property: "numberofemployees" },
      options: [
        { value: "1-10", label: "1 à 10" },
        { value: "11-50", label: "11 à 50" },
      ],
    });
  });

  it("turns a two-field group into a half/half row", () => {
    const fields = convertHubspotForm(raw).definition.steps[0]!.fields;
    expect(fields[0]!.width).toBe("half");
    expect(fields[1]!.width).toBe("half");
    expect(fields[2]!.width).toBeUndefined();
  });

  it("gives every field and step an id, unique within the form", () => {
    const out = convertHubspotForm(raw);
    const ids = [
      out.definition.steps[0]!.id,
      ...out.definition.steps[0]!.fields.map((f) => f.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.definition.steps[0]!.id).toMatch(/^stp_/);
    for (const field of out.definition.steps[0]!.fields) expect(field.id).toMatch(/^fld_/);
  });

  it("converts dependent fields into backward-looking visibleIf conditions", () => {
    const out = convertHubspotForm({
      name: "Conditions",
      fieldGroups: [
        {
          fields: [
            {
              objectTypeId: "0-1",
              name: "besoin",
              label: "Besoin",
              fieldType: "radio",
              options: [{ value: "recrutement" }, { value: "formation" }],
              dependentFields: [
                {
                  dependentCondition: { operator: "SET_ANY", values: ["recrutement", "interim"] },
                  field: {
                    objectTypeId: "0-1",
                    name: "poste",
                    label: "Poste recherché",
                    fieldType: "single_line_text",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(out.skipped).toEqual([]);
    const [parent, child] = out.definition.steps[0]!.fields;
    expect(child).toMatchObject({
      name: "poste",
      visibleIf: {
        logic: "or",
        rules: [
          { field: parent!.id, operator: "eq", value: "recrutement" },
          { field: parent!.id, operator: "eq", value: "interim" },
        ],
      },
    });
  });

  it("imports a dependent field without its condition when the operator has no equivalent", () => {
    const out = convertHubspotForm({
      name: "Opérateur inconnu",
      fieldGroups: [
        {
          fields: [
            {
              objectTypeId: "0-1",
              name: "budget",
              label: "Budget",
              fieldType: "number",
              dependentFields: [
                {
                  dependentCondition: { operator: "RANGE", values: ["1", "10"] },
                  field: {
                    objectTypeId: "0-1",
                    name: "detail",
                    label: "Détail",
                    fieldType: "single_line_text",
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const child = out.definition.steps[0]!.fields[1];
    expect(child).toMatchObject({ name: "detail" });
    expect(child!.visibleIf).toBeUndefined();
    expect(out.skipped).toEqual([{ code: "condition", label: "Détail", detail: "RANGE" }]);
  });

  it("skips and reports what the builder can't express", () => {
    const out = convertHubspotForm({
      name: "Pertes",
      fieldGroups: [
        { richText: "<p>Un bloc de contenu</p>" },
        {
          fields: [
            { objectTypeId: "0-1", name: "cv", label: "CV", fieldType: "file" },
            { objectTypeId: "0-1", name: "utm", label: "UTM", fieldType: "single_line_text", hidden: true },
            { objectTypeId: "0-3", name: "amount", label: "Montant", fieldType: "number" },
            { objectTypeId: "0-1", name: "email", label: "Email", fieldType: "email" },
            { objectTypeId: "0-1", name: "email", label: "Email bis", fieldType: "email" },
          ],
        },
      ],
      legalConsentOptions: { type: "explicit_consent_to_process" },
    });
    expect(out.definition.steps[0]!.fields.map((f) => f.name)).toEqual(["email"]);
    expect(out.skipped).toEqual([
      { code: "rich-text", detail: "<p>Un bloc de contenu</p>" },
      { code: "field-type", label: "CV", detail: "file" },
      { code: "hidden-field", label: "UTM" },
      { code: "object", label: "Montant", detail: "0-3" },
      { code: "duplicate", label: "Email bis", detail: "email" },
      { code: "legal-consent" },
    ]);
  });

  it("survives an empty or unexpected payload", () => {
    expect(convertHubspotForm({})).toMatchObject({
      name: "",
      definition: { version: 1, steps: [{ fields: [] }] },
      skipped: [],
    });
  });
});
