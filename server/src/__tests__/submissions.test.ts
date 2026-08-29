import { describe, expect, it } from "vitest";
import type { FormDefinition } from "../conditions";
import { fieldOrder, submissionsCsv, type SubmissionRow } from "../submissions";

const definition: FormDefinition = {
  version: 1,
  steps: [
    {
      id: "stp_1",
      fields: [
        { id: "fld_1", name: "email", type: "email" },
        { id: "fld_2", name: "besoin", type: "select" },
      ],
    },
    { id: "stp_2", fields: [{ id: "fld_3", name: "message", type: "textarea" }] },
  ],
};

const rows: SubmissionRow[] = [
  {
    documentId: "a",
    form: "demo",
    email: "marie@acme.fr",
    values: { email: "marie@acme.fr", besoin: "recrutement", message: 'Dit "urgent", virgule, aussi' },
    meta: { pagePath: "/contact", source: "hero" },
    locale: "fr",
    hubspotSynced: true,
    createdAt: "2026-08-29T10:00:00.000Z",
  },
  {
    documentId: "b",
    form: "demo",
    values: { email: "old@acme.fr", ancien_champ: "gardé" },
    hubspotSynced: false,
    createdAt: "2026-08-28T09:00:00.000Z",
  },
];

describe("fieldOrder", () => {
  it("flattens the definition in reading order", () => {
    expect(fieldOrder(definition)).toEqual(["email", "besoin", "message"]);
    expect(fieldOrder(null)).toEqual([]);
  });
});

describe("submissionsCsv", () => {
  it("leads with the definition columns and appends historical extras", () => {
    const csv = submissionsCsv(rows, fieldOrder(definition));
    const [header, first, second] = csv.split("\r\n");
    expect(header).toBe(
      "submittedAt,email,besoin,message,ancien_champ,hubspotSynced,locale,pagePath,source",
    );
    expect(first).toBe(
      '2026-08-29T10:00:00.000Z,marie@acme.fr,recrutement,"Dit ""urgent"", virgule, aussi",,true,fr,/contact,hero',
    );
    expect(second).toBe("2026-08-28T09:00:00.000Z,old@acme.fr,,,gardé,false,,,");
  });

  it("produces a bare header for zero submissions", () => {
    expect(submissionsCsv([], ["email"])).toBe(
      "submittedAt,email,hubspotSynced,locale,pagePath,source",
    );
  });
});
