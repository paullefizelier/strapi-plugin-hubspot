import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// cwd-relative: vitest runs from the repo root, and the build's CJS
// typecheck rejects import.meta.
const realFixture = JSON.parse(
  readFileSync("server/src/__tests__/fixtures/recherche-entreprises.json", "utf8"),
);
import {
  companyProperties,
  headcountLabelOf,
  nafLabelOf,
  normalizeCompanyHits,
  normalizeQuery,
  pickSiret,
  type CompanyMap,
  type SearchPayload,
} from "../company";

/** Hand-written minimal payload — every edge the normalizer must handle. */
const payload: SearchPayload = {
  results: [
    {
      nom_complet: "ACME GROUPE (ACME)",
      nom_raison_sociale: "ACME GROUPE",
      siren: "111222333",
      etat_administratif: "A",
      activite_principale: "70.10Z",
      tranche_effectif_salarie: "22",
      siege: {
        siret: "11122233300011",
        adresse: "1 RUE DE LA PAIX 75002 PARIS",
        code_postal: "75002",
        libelle_commune: "PARIS",
        est_siege: true,
        etat_administratif: "A",
        activite_principale: "70.10Z",
        tranche_effectif_salarie: "12",
      },
      matching_etablissements: [
        {
          // The siège often shows up here too — must be deduped.
          siret: "11122233300011",
          adresse: "1 RUE DE LA PAIX 75002 PARIS",
          code_postal: "75002",
          libelle_commune: "PARIS",
          est_siege: true,
          etat_administratif: "A",
        },
        {
          siret: "11122233300029",
          adresse: "9 QUAI DES BELGES 13001 MARSEILLE",
          code_postal: "13001",
          libelle_commune: "MARSEILLE",
          est_siege: false,
          etat_administratif: "A",
          // No own activity/headcount → fall back to the entreprise's.
        },
        {
          siret: "11122233300037",
          adresse: "FERMÉ",
          est_siege: false,
          etat_administratif: "F", // closed — filtered from search results
        },
      ],
    },
  ],
};

describe("normalizeCompanyHits", () => {
  const hits = normalizeCompanyHits(payload);

  it("flattens the siège and open matching établissements, deduped", () => {
    expect(hits.map((h) => h.siret)).toEqual(["11122233300011", "11122233300029"]);
  });

  it("carries identity, address parts and the headquarters flag", () => {
    expect(hits[0]).toMatchObject({
      siren: "111222333",
      name: "ACME GROUPE",
      address: "1 RUE DE LA PAIX 75002 PARIS",
      zip: "75002",
      city: "PARIS",
      headquarters: true,
    });
    expect(hits[1].headquarters).toBe(false);
  });

  it("resolves NAF from the établissement, falling back to the entreprise", () => {
    expect(hits[0].naf).toBe("70.10Z");
    expect(hits[0].nafLabel).toBe("Activités des sièges sociaux");
    expect(hits[1].naf).toBe("70.10Z"); // entreprise fallback
  });

  it("labels the INSEE headcount range, établissement first", () => {
    expect(hits[0].headcount).toBe(headcountLabelOf("12"));
    expect(hits[1].headcount).toBe(headcountLabelOf("22")); // entreprise fallback
  });

  it("filters closed établissements out of search results", () => {
    expect(hits.some((h) => h.siret === "11122233300037")).toBe(false);
  });

  it("survives the real API payload — valid identities, no duplicates", () => {
    const real = normalizeCompanyHits(realFixture as SearchPayload);
    expect(real.length).toBeGreaterThan(0);
    for (const hit of real) {
      expect(hit.siret).toMatch(/^\d{14}$/);
      expect(hit.siren).toMatch(/^\d{9}$/);
      expect(hit.name).toBeTruthy();
    }
    expect(new Set(real.map((h) => h.siret)).size).toBe(real.length);
  });
});

describe("pickSiret", () => {
  it("finds an exact établissement, even a closed one — the visitor chose it", () => {
    const closed = pickSiret(payload, "11122233300037");
    expect(closed).toMatchObject({ siret: "11122233300037", closed: true });
  });

  it("finds the siège and returns null for an unknown siret", () => {
    expect(pickSiret(payload, "11122233300011")?.headquarters).toBe(true);
    expect(pickSiret(payload, "99999999900000")).toBeNull();
  });
});

describe("nafLabelOf / headcountLabelOf", () => {
  it("labels a known NAF code and returns undefined for an unknown one", () => {
    expect(nafLabelOf("70.10Z")).toBe("Activités des sièges sociaux");
    expect(nafLabelOf("00.00X")).toBeUndefined();
  });

  it("labels INSEE headcount codes and refuses NN / unknown", () => {
    expect(headcountLabelOf("12")).toBe("20 à 49 salariés");
    expect(headcountLabelOf("NN")).toBeUndefined();
    expect(headcountLabelOf(undefined)).toBeUndefined();
  });
});

describe("companyProperties", () => {
  const hit = normalizeCompanyHits(payload)[0];
  const map: CompanyMap = {
    name: { object: "company", property: "name" },
    siret: { object: "company", property: "siret" },
    city: { object: "contact", property: "city" },
    headquarters: { object: "company", property: "est_siege" },
    headcount: { object: "company", property: "effectif" },
  };

  it("routes each mapped datum to its object under its CRM property", () => {
    expect(companyProperties(map, hit)).toEqual({
      company: {
        name: "ACME GROUPE",
        siret: "11122233300011",
        est_siege: true,
        effectif: headcountLabelOf("12"),
      },
      contact: { city: "PARIS" },
    });
  });

  it("skips unmapped data, incomplete mappings and absent values", () => {
    const sparse: CompanyMap = {
      naf: { object: "company", property: "code_naf" },
      nafLabel: { object: "company" }, // no property → skipped
      headcount: { object: "company", property: "effectif" },
    };
    const noExtras = { ...hit, naf: undefined, nafLabel: undefined, headcount: undefined };
    expect(companyProperties(sparse, noExtras)).toEqual({});
  });
});

describe("normalizeQuery", () => {
  it("recognizes a pasted SIRET/SIREN despite spaces, dots and dashes", () => {
    expect(normalizeQuery(" 798 841 284 00010 ")).toBe("79884128400010");
    expect(normalizeQuery("798.841.284")).toBe("798841284");
    expect(normalizeQuery("798-841-284")).toBe("798841284");
  });

  it("leaves plain text queries untouched (just trimmed)", () => {
    expect(normalizeQuery("  Actual Leader ")).toBe("Actual Leader");
    // Digits inside text are not an identifier.
    expect(normalizeQuery("3M France")).toBe("3M France");
    // Digit runs that are neither SIREN nor SIRET stay as typed.
    expect(normalizeQuery("12345")).toBe("12345");
  });
});
