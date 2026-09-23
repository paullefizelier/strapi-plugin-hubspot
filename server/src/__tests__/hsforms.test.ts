import { describe, expect, it } from "vitest";
import {
  filterToFormFields,
  fieldsForHubspotForm,
  formFieldNames,
  formsHost,
  formsSubmitUrl,
  isFormGuid,
  parseFormShape,
  buildLegalConsent,
  canRetryEmailOnly,
  sanitizeHutk,
  sanitizePortalId,
  toHsFields,
  trackingScriptUrl,
} from "../hsforms";

describe("region hosts", () => {
  it("uses the EU Forms API host for eu1", () => {
    expect(formsHost("eu1")).toBe("api-eu1.hsforms.com");
    expect(formsSubmitUrl("148991818", "c5c65fe8-4cde-4a17-8960-21696b53561e", "eu1")).toBe(
      "https://api-eu1.hsforms.com/submissions/v3/integration/secure/submit/148991818/c5c65fe8-4cde-4a17-8960-21696b53561e",
    );
    expect(trackingScriptUrl("148991818", "eu1")).toBe(
      "https://js-eu1.hs-scripts.com/148991818.js",
    );
  });

  it("uses the NA host when the region is na1 — production can flip via config", () => {
    expect(formsHost("na1")).toBe("api.hsforms.com");
    expect(trackingScriptUrl("99", "na1")).toBe("https://js.hs-scripts.com/99.js");
  });
});

describe("id guards", () => {
  it("accepts a portal id and a form GUID, rejects junk", () => {
    expect(sanitizePortalId("148991818")).toBe("148991818");
    expect(sanitizePortalId("not-a-portal")).toBeUndefined();
    expect(isFormGuid("c5c65fe8-4cde-4a17-8960-21696b53561e")).toBe(true);
    expect(isFormGuid("c5c65fe8")).toBe(false);
  });

  it("only forwards a plausible hubspotutk", () => {
    expect(sanitizeHutk("aabbccddeeff00112233445566778899")).toBe(
      "aabbccddeeff00112233445566778899",
    );
    expect(sanitizeHutk("not a cookie")).toBeUndefined();
    expect(sanitizeHutk(1)).toBeUndefined();
  });
});

describe("form field filtering", () => {
  it("drops properties the HubSpot form doesn't declare — extras 400 the submit", () => {
    const fields = toHsFields({ email: "a@b.co", firstname: "Ada", leftover: "x" });
    expect(filterToFormFields(fields, new Set(["email", "firstname"]))).toEqual([
      { name: "email", value: "a@b.co" },
      { name: "firstname", value: "Ada" },
    ]);
  });

  it("reads field names off a marketing-v3 form payload", () => {
    expect(
      formFieldNames({
        fieldGroups: [
          { fields: [{ name: "email" }, { name: "firstname" }] },
          { fields: [{ name: "phone" }] },
        ],
      }),
    ).toEqual(["email", "firstname", "phone"]);
  });
});

describe("form shape / consent", () => {
  it("reads CAPTCHA, required fields and communication checkboxes", () => {
    const shape = parseFormShape({
      fieldGroups: [
        { fields: [{ name: "email", required: true }, { name: "firstname" }] },
      ],
      configuration: { captchaEnabled: true },
      legalConsentOptions: {
        type: "explicit_consent_to_process",
        consentToProcessText: "J'accepte le traitement.",
        communicationsCheckboxes: [
          { subscriptionTypeId: 42, label: "Newsletter" },
        ],
      },
    });
    expect(shape.captcha).toBe(true);
    expect([...shape.required]).toEqual(["email"]);
    expect(shape.hasLegalConsent).toBe(true);
    expect(shape.communications).toEqual([
      { subscriptionTypeId: 42, text: "Newsletter" },
    ]);
  });

  it("treats HubSpot's recaptchaEnabled flag as CAPTCHA (the Forms API field name)", () => {
    expect(parseFormShape({ configuration: { recaptchaEnabled: true } }).captcha).toBe(true);
    expect(parseFormShape({ configuration: { recaptchaEnabled: false } }).captcha).toBe(false);
  });

  it("builds HubSpot legalConsentOptions with communications when the form has a GDPR block", () => {
    const legal = buildLegalConsent(
      {
        hasLegalConsent: true,
        consentToProcessText: "Traitement OK",
        communications: [{ subscriptionTypeId: 7, text: "News" }],
        subscriptionTypeIds: [],
      },
      true,
    );
    expect(legal).toEqual({
      consent: {
        consentToProcess: true,
        text: "Traitement OK",
        communications: [{ value: true, subscriptionTypeId: 7, text: "News" }],
      },
    });
  });

  it("does not retry email-only when HubSpot requires other fields", () => {
    expect(canRetryEmailOnly(["email"])).toBe(true);
    expect(canRetryEmailOnly(["email", "firstname"])).toBe(false);
    expect(canRetryEmailOnly([])).toBe(true);
  });

  it("builds legitimateInterest consent for HubSpot forms that use that GDPR mode", () => {
    const shape = parseFormShape({
      legalConsentOptions: {
        type: "legitimate_interest",
        lawfulBasis: "lead",
        privacyText: "Intérêt légitime.",
        subscriptionTypeIds: [99],
      },
    });
    expect(shape.hasLegalConsent).toBe(true);
    expect(shape.legalType).toBe("legitimate_interest");
    expect(buildLegalConsent(shape, true)).toEqual({
      legitimateInterest: {
        value: true,
        subscriptionTypeId: 99,
        legalBasis: "LEAD",
        text: "Intérêt légitime.",
      },
    });
  });

  it("sends company properties with objectTypeId 0-2 when the HubSpot form declares them", () => {
    const shape = parseFormShape({
      fieldGroups: [
        {
          fields: [
            { name: "email", objectTypeId: "0-1", required: true },
            { name: "name", objectTypeId: "0-2", required: true },
          ],
        },
      ],
    });
    expect(
      fieldsForHubspotForm(
        { contact: { email: "a@b.co" }, company: { name: "Acme" } },
        shape,
      ),
    ).toEqual([
      { name: "email", value: "a@b.co", objectTypeId: "0-1" },
      { name: "name", value: "Acme", objectTypeId: "0-2" },
    ]);
  });
});
