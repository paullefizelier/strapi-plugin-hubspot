import { describe, expect, it } from "vitest";
import { convertLegacyForm } from "../importLegacy";

/** A realistic api::form.form entry, as the host app's schema shapes it. */
const legacy = {
  name: "Qualification B2B",
  slug: "qualification-b2b",
  title: "Parlons de votre besoin",
  subtitle: "2 minutes chrono",
  nextLabel: "Suivant",
  submitLabel: "Envoyer",
  successMessage: "Merci !",
  steps: [
    {
      title: "Votre besoin",
      description: "Dites-nous en plus",
      class: "step--first",
      fields: [
        {
          label: "Votre email",
          name: "email",
          hsObject: "contact",
          hsProperty: "email",
          type: "email",
          placeholder: "vous@entreprise.fr",
          required: true,
          icon: "mail",
          options: [],
          width: "full",
          helpText: "Jamais partagé",
          class: "field--email",
          persist: "days30",
        },
        {
          label: "Effectif",
          name: "effectif",
          hsObject: "company",
          hsProperty: "numberofemployees",
          type: "select",
          required: false,
          options: [
            { value: "1-10", label: "1 à 10" },
            { value: "11-50", label: "11 à 50" },
          ],
          width: "half",
        },
      ],
    },
    { title: "Vos coordonnées", fields: [] },
  ],
};

describe("convertLegacyForm", () => {
  it("maps the flat meta one to one", () => {
    const out = convertLegacyForm(legacy);
    expect(out).toMatchObject({
      name: "Qualification B2B",
      slug: "qualification-b2b",
      title: "Parlons de votre besoin",
      subtitle: "2 minutes chrono",
      nextLabel: "Suivant",
      submitLabel: "Envoyer",
      successMessage: "Merci !",
    });
  });

  it("converts steps and fields, generating stable-unique ids", () => {
    const out = convertLegacyForm(legacy);
    expect(out.definition.version).toBe(1);
    expect(out.definition.steps).toHaveLength(2);
    const [step] = out.definition.steps;
    expect(step).toMatchObject({ title: "Votre besoin", description: "Dites-nous en plus", class: "step--first" });
    expect(step.id).toMatch(/^stp_/);
    const [email, effectif] = step.fields;
    expect(email).toMatchObject({
      name: "email",
      label: "Votre email",
      type: "email",
      placeholder: "vous@entreprise.fr",
      required: true,
      icon: "mail",
      width: "full",
      helpText: "Jamais partagé",
      class: "field--email",
      persist: "days30",
      hubspot: { object: "contact", property: "email" },
    });
    expect(email.id).toMatch(/^fld_/);
    expect(effectif.options).toEqual([
      { value: "1-10", label: "1 à 10" },
      { value: "11-50", label: "11 à 50" },
    ]);
    expect(new Set(step.fields.map((f) => f.id)).size).toBe(2);
  });

  it("honors a custom attribute mapping", () => {
    const custom = {
      name: "Contact",
      slug: "contact",
      etapes: [
        {
          titre: "Étape",
          champs: [{ libelle: "Email", cle: "email", objet: "contact", propriete: "email", type: "email" }],
        },
      ],
    };
    const out = convertLegacyForm(custom, {
      steps: "etapes",
      fields: "champs",
      step: { title: "titre" },
      field: { label: "libelle", name: "cle", object: "objet", property: "propriete" },
    });
    expect(out.definition.steps[0].title).toBe("Étape");
    expect(out.definition.steps[0].fields[0]).toMatchObject({
      label: "Email",
      name: "email",
      hubspot: { object: "contact", property: "email" },
    });
  });

  it("defaults a field with no mapping to no hubspot block, and no name to its label", () => {
    const out = convertLegacyForm({
      name: "X",
      slug: "x",
      steps: [{ fields: [{ label: "Commentaire", type: "textarea" }] }],
    });
    const [field] = out.definition.steps[0].fields;
    expect(field.name).toBe("commentaire");
    expect(field.hubspot).toBeUndefined();
  });
});
