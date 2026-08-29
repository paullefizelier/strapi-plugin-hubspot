import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "@strapi/strapi";
import type { FormDefinition } from "../conditions";
import { createFormsService, SUBMISSION_UID, type FormEntry } from "../forms";
import { clearCache } from "../properties";
import { createSubmitService } from "../submit";

/**
 * The pipeline touches HubSpot through fetch (schema, contact upsert, company
 * search/create, association, note) and Strapi through `documents` (submission
 * rows, failure queue). Everything else is real code — including the actual
 * submit service.
 */

const schemaBodies: Record<string, unknown> = {
  "/crm/v3/properties/contacts": {
    results: [
      { name: "email", label: "Email", type: "string" },
      { name: "firstname", label: "First name", type: "string" },
      { name: "city", label: "City", type: "string" },
      {
        name: "hs_role",
        label: "Rôle",
        type: "enumeration",
        options: [{ value: "dev" }, { value: "designer" }],
      },
    ],
  },
  "/crm/v3/properties/companies": {
    results: [
      { name: "name", label: "Name", type: "string" },
      { name: "numberofemployees", label: "Employees", type: "number" },
      { name: "domain", label: "Domain", type: "string" },
      { name: "siret_custom", label: "SIRET", type: "string" },
    ],
  },
  "/account-info/v3/details": {},
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

function mockFetch({
  upsertStatus = () => 200,
  companyFound = false,
  noteStatus = 200,
  sirene = () => ({ status: 404, body: {} as unknown }),
}: {
  upsertStatus?: (attempt: number) => number;
  companyFound?: boolean;
  noteStatus?: number;
  sirene?: (query: string) => { status: number; body: unknown };
} = {}) {
  let upsertAttempts = 0;
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: { method?: string; body?: string }) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    const call: Call = {
      method: init?.method ?? "GET",
      path: parsed.host.includes("recherche-entreprises") ? `sirene:${parsed.search}` : path,
      body: init?.body ? JSON.parse(init.body) : {},
    };
    calls.push(call);

    const respond = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    });

    if (parsed.host.includes("recherche-entreprises")) {
      const res = sirene(parsed.search);
      return respond(res.status, res.body);
    }

    if (path.endsWith("/contacts/batch/upsert")) {
      upsertAttempts += 1;
      const status = upsertStatus(upsertAttempts);
      return respond(status, status < 400 ? { results: [{ id: "contact-1" }] } : { message: "boom" });
    }
    if (path.endsWith("/companies/search")) {
      return respond(200, { results: companyFound ? [{ id: "company-1" }] : [] });
    }
    if (path.endsWith("/objects/companies") && call.method === "POST") {
      return respond(201, { id: "company-2" });
    }
    if (/\/objects\/companies\/[^/]+$/.test(path) && call.method === "PATCH") {
      return respond(200, { id: "company-1" });
    }
    if (path.includes("/associations/")) {
      return respond(200, {});
    }
    if (path.endsWith("/objects/notes")) {
      return respond(noteStatus, noteStatus < 400 ? { id: "note-1" } : { message: "no note" });
    }
    const body = schemaBodies[path];
    return respond(body ? 200 : 404, body ?? {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

function makeStrapi({ apiKey = "key", formsConfig = {} as Record<string, unknown> } = {}) {
  const rows: Record<string, Record<string, unknown>[]> = {};
  let seq = 0;
  const documentsFor = (uid: string) => {
    const list = (rows[uid] ??= []);
    return {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { documentId: `${uid}-${(seq += 1)}`, ...data };
        list.push(row);
        return row;
      }),
      findMany: vi.fn(async () => [...list]),
      findFirst: vi.fn(async () => list[0] ?? null),
      delete: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      count: vi.fn(async () => list.length),
    };
  };
  const config: Record<string, unknown> = {
    objects: ["contact", "company"],
    forms: formsConfig,
  };
  const strapi = {
    store: () => ({ get: async () => (apiKey ? { apiKey } : {}) }),
    plugin: () => ({
      config: (key: string, def: unknown) => config[key] ?? def,
      service: () => submitService,
    }),
    documents: (uid: string) => documentsFor(uid),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  } as unknown as Core.Strapi;
  const submitService = createSubmitService(strapi, { sleep: async () => {} });
  return { strapi, rows };
}

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
          id: "fld_role",
          name: "role",
          label: "Rôle",
          type: "select",
          options: [{ value: "dev", label: "Développeur" }],
          hubspot: { object: "contact", property: "hs_role" },
        },
        {
          id: "fld_size",
          name: "size",
          label: "Effectif",
          type: "number",
          visibleIf: { logic: "and", rules: [{ field: "fld_role", operator: "eq", value: "dev" }] },
          hubspot: { object: "company", property: "numberofemployees" },
        },
      ],
    },
  ],
};

const formEntry: FormEntry = {
  name: "Qualification",
  slug: "qualification",
  title: "Parlons-en",
  locale: "fr",
  definition,
};

const service = (strapi: Core.Strapi) => createFormsService(strapi, { sleep: async () => {} });

const meta = { pagePath: "/entreprises", pageUrl: "https://x.co/entreprises", originLabel: "Intérim" };

beforeEach(() => clearCache());
afterEach(() => vi.unstubAllGlobals());

describe("forms.submit", () => {
  it("refuses a submission missing a required visible field — nothing sent, nothing stored", async () => {
    const { calls } = mockFetch();
    const { strapi, rows } = makeStrapi();
    const out = await service(strapi).submit(formEntry, { firstname: "Jane" }, meta);
    expect(out.ok).toBe(false);
    expect(out.missingRequired).toEqual([{ id: "fld_email", name: "email", label: "Email" }]);
    expect(calls.filter((c) => c.path.includes("upsert"))).toHaveLength(0);
    expect(rows[SUBMISSION_UID] ?? []).toHaveLength(0);
  });

  it("upserts the contact with mapped properties and stores a synced submission", async () => {
    const { calls } = mockFetch();
    const { strapi, rows } = makeStrapi();
    const out = await service(strapi).submit(
      formEntry,
      { email: "jane@gmail.com", firstname: "Jane", role: "dev" },
      meta,
    );
    expect(out).toMatchObject({ ok: true, hubspotSynced: true });

    const upsert = calls.find((c) => c.path.endsWith("/contacts/batch/upsert"));
    const input = (upsert?.body as { inputs: { id: string; properties: Record<string, string> }[] })
      .inputs[0];
    expect(input.id).toBe("jane@gmail.com");
    expect(input.properties).toMatchObject({
      email: "jane@gmail.com",
      firstname: "Jane",
      hs_role: "dev",
    });

    const row = rows[SUBMISSION_UID][0];
    expect(row).toMatchObject({
      form: "qualification",
      email: "jane@gmail.com",
      locale: "fr",
      hubspotSynced: true,
      contactId: "contact-1",
    });
    expect(row.values).toEqual({ email: "jane@gmail.com", firstname: "Jane", role: "dev" });
  });

  it("discards the value of a condition-hidden field — not sent, not stored", async () => {
    const { calls } = mockFetch();
    const { strapi, rows } = makeStrapi();
    // role ≠ dev → `size` is hidden, even though the browser sent it.
    await service(strapi).submit(
      formEntry,
      { email: "jane@gmail.com", role: "designer", size: 12 },
      meta,
    );
    const bodies = calls.map((c) => JSON.stringify(c.body)).join("");
    expect(bodies).not.toContain("numberofemployees");
    expect((rows[SUBMISSION_UID][0].values as Record<string, unknown>).size).toBeUndefined();
  });

  it("stores the submission unsynced when no email is present — no CRM call", async () => {
    const noEmailForm: FormEntry = {
      ...formEntry,
      definition: {
        version: 1,
        steps: [{ id: "s", fields: [{ id: "f", name: "phone", label: "Tél", type: "tel" }] }],
      },
    };
    const { calls } = mockFetch();
    const { strapi, rows } = makeStrapi();
    const out = await service(strapi).submit(noEmailForm, { phone: "0600000000" }, meta);
    expect(out).toMatchObject({ ok: true, hubspotSynced: false });
    expect(calls.filter((c) => c.path.includes("hubapi") || c.path.includes("upsert"))).toHaveLength(0);
    expect(rows[SUBMISSION_UID][0]).toMatchObject({ hubspotSynced: false });
  });

  it("resolves the company by corporate domain, associates it, and notes both", async () => {
    const { calls } = mockFetch({ companyFound: true });
    const { strapi, rows } = makeStrapi();
    await service(strapi).submit(
      formEntry,
      { email: "jane@acme.com", role: "dev", size: 12 },
      meta,
    );
    const search = calls.find((c) => c.path.endsWith("/companies/search"));
    expect(JSON.stringify(search?.body)).toContain("acme.com");
    // Found → updated in place, then associated to the contact.
    expect(calls.some((c) => c.method === "PATCH" && c.path.endsWith("/companies/company-1"))).toBe(true);
    expect(
      calls.some((c) => c.path.includes("/contacts/contact-1/associations/default/companies/company-1")),
    ).toBe(true);
    const note = calls.find((c) => c.path.endsWith("/objects/notes"));
    expect(JSON.stringify(note?.body)).toContain("company-1");
    expect(rows[SUBMISSION_UID][0]).toMatchObject({ companyId: "company-1" });
  });

  it("creates the company when the domain is unknown to the portal", async () => {
    const { calls } = mockFetch({ companyFound: false });
    const { strapi } = makeStrapi();
    await service(strapi).submit(formEntry, { email: "jane@acme.com", role: "dev", size: 12 }, meta);
    const created = calls.find((c) => c.method === "POST" && c.path.endsWith("/objects/companies"));
    expect((created?.body as { properties: Record<string, string> }).properties).toMatchObject({
      domain: "acme.com",
      numberofemployees: "12",
    });
  });

  it("never creates a company for a free-mail address", async () => {
    const { calls } = mockFetch();
    const { strapi } = makeStrapi();
    await service(strapi).submit(formEntry, { email: "jane@gmail.com", role: "dev" }, meta);
    expect(calls.some((c) => c.path.endsWith("/companies/search"))).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/objects/companies"))).toBe(false);
  });

  it("drops a property the portal would reject and sends the rest", async () => {
    const badForm: FormEntry = {
      ...formEntry,
      definition: {
        version: 1,
        steps: [
          {
            id: "s",
            fields: [
              {
                id: "f1",
                name: "email",
                label: "Email",
                type: "email",
                hubspot: { object: "contact", property: "email" },
              },
              {
                id: "f2",
                name: "typo",
                label: "Typo",
                type: "text",
                hubspot: { object: "contact", property: "hs_rôle" },
              },
            ],
          },
        ],
      },
    };
    const { calls } = mockFetch();
    const { strapi, rows } = makeStrapi();
    const out = await service(strapi).submit(badForm, { email: "j@gmail.com", typo: "x" }, meta);
    expect(out).toMatchObject({ ok: true, hubspotSynced: true });
    const upsert = calls.find((c) => c.path.endsWith("/contacts/batch/upsert"));
    expect(JSON.stringify(upsert?.body)).not.toContain("hs_rôle");
    // The mis-mapping is recorded on the submission for someone to fix.
    expect(JSON.stringify(rows[SUBMISSION_UID][0].rejected)).toContain("hs_rôle");
  });

  it("still succeeds when the timeline note fails — best-effort", async () => {
    mockFetch({ noteStatus: 500 });
    const { strapi } = makeStrapi();
    const out = await service(strapi).submit(formEntry, { email: "jane@gmail.com" }, meta);
    expect(out).toMatchObject({ ok: true, hubspotSynced: true });
  });

  it("skips company and note when the config turns them off", async () => {
    const { calls } = mockFetch();
    const { strapi } = makeStrapi({
      formsConfig: { companyFromDomain: false, timelineNote: false },
    });
    await service(strapi).submit(formEntry, { email: "jane@acme.com", role: "dev", size: 12 }, meta);
    expect(calls.some((c) => c.path.endsWith("/companies/search"))).toBe(false);
    expect(calls.some((c) => c.path.endsWith("/objects/notes"))).toBe(false);
  });

  it("stores the submission unsynced when the contact upsert keeps failing", async () => {
    mockFetch({ upsertStatus: () => 503 });
    const { strapi, rows } = makeStrapi();
    const out = await service(strapi).submit(formEntry, { email: "jane@gmail.com" }, meta);
    // The lead is never lost: parked in the failure queue AND stored unsynced.
    expect(out).toMatchObject({ ok: true, hubspotSynced: false });
    expect(rows[SUBMISSION_UID][0]).toMatchObject({ hubspotSynced: false });
    expect(rows["plugin::hubspot.failure"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Company field (INSEE/SIRENE) pipeline

const SIRET = "11122233300011";
const sirenePayload = {
  results: [
    {
      nom_raison_sociale: "TEST CORP",
      nom_complet: "TEST CORP",
      siren: "111222333",
      activite_principale: "70.10Z",
      tranche_effectif_salarie: "12",
      siege: {
        siret: SIRET,
        adresse: "1 RUE X 75002 PARIS",
        code_postal: "75002",
        libelle_commune: "PARIS",
        est_siege: true,
        etat_administratif: "A",
      },
      matching_etablissements: [],
    },
  ],
};

const companyForm: FormEntry = {
  name: "Contact société",
  slug: "societe",
  title: "Contact",
  locale: "fr",
  definition: {
    version: 1,
    steps: [
      {
        id: "s",
        fields: [
          {
            id: "f_email",
            name: "email",
            label: "Email",
            type: "email",
            hubspot: { object: "contact", property: "email" },
          },
          {
            id: "f_co",
            name: "entreprise",
            label: "Entreprise",
            type: "company",
            companyMap: {
              name: { object: "company", property: "name" },
              siret: { object: "company", property: "siret_custom" },
              city: { object: "contact", property: "city" },
            },
          },
        ],
      },
    ],
  },
};

describe("forms.submit — company field", () => {
  it("re-resolves the SIRET server-side and maps the INSEE data", async () => {
    const { calls } = mockFetch({
      companyFound: true,
      sirene: () => ({ status: 200, body: sirenePayload }),
    });
    const { strapi, rows } = makeStrapi();
    const out = await service(strapi).submit(
      companyForm,
      { email: "jane@gmail.com", entreprise: "Test Corp", entreprise__siret: SIRET },
      meta,
    );
    expect(out).toMatchObject({ ok: true, hubspotSynced: true });

    // The authority is the API, queried by the 14-digit siret.
    expect(calls.some((c) => c.path === `sirene:?q=${SIRET}&per_page=1`)).toBe(true);

    // contact-mapped datum rides the contact upsert…
    const upsert = calls.find((c) => c.path.endsWith("/contacts/batch/upsert"));
    expect(JSON.stringify(upsert?.body)).toContain('"city":"PARIS"');

    // …and the company is deduped by the mapped SIRET property, gmail or not.
    const search = calls.find((c) => c.path.endsWith("/companies/search"));
    expect(JSON.stringify(search?.body)).toContain("siret_custom");
    expect(JSON.stringify(search?.body)).toContain(SIRET);
    const patch = calls.find((c) => c.method === "PATCH" && /\/companies\/company-1$/.test(c.path));
    expect(JSON.stringify(patch?.body)).toContain('"name":"TEST CORP"');

    // The resolved record is persisted with the submission.
    const row = rows[SUBMISSION_UID][0];
    expect(row.companies).toEqual([
      expect.objectContaining({ field: "entreprise", siret: SIRET, name: "TEST CORP", resolved: true }),
    ]);
  });

  it("falls back to the browser snapshot when the API is down — flagged unresolved", async () => {
    const { calls } = mockFetch({ sirene: () => ({ status: 503, body: {} }) });
    const { strapi, rows } = makeStrapi();
    const snapshot = JSON.stringify({
      siret: SIRET,
      siren: "111222333",
      name: "SNAP CORP",
      city: "LYON",
      headquarters: true,
    });
    await service(strapi).submit(
      companyForm,
      {
        email: "jane@gmail.com",
        entreprise: "Snap Corp",
        entreprise__siret: SIRET,
        entreprise__company: snapshot,
      },
      meta,
    );
    const upsert = calls.find((c) => c.path.endsWith("/contacts/batch/upsert"));
    expect(JSON.stringify(upsert?.body)).toContain('"city":"LYON"');
    expect(rows[SUBMISSION_UID][0].companies).toEqual([
      expect.objectContaining({ name: "SNAP CORP", resolved: false }),
    ]);
  });

  it("free text: only the name mapping receives the typed value, no SIRENE call", async () => {
    const { calls } = mockFetch();
    const { strapi, rows } = makeStrapi();
    await service(strapi).submit(
      companyForm,
      { email: "jane@gmail.com", entreprise: "Ma Petite Boîte" },
      meta,
    );
    expect(calls.some((c) => c.path.startsWith("sirene:"))).toBe(false);
    // gmail + no siret: nothing dedupes a company — none is searched or created.
    expect(calls.some((c) => c.path.endsWith("/companies/search"))).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/objects/companies"))).toBe(false);
    const row = rows[SUBMISSION_UID][0];
    expect(row.companies).toEqual([
      expect.objectContaining({ field: "entreprise", name: "Ma Petite Boîte", resolved: false }),
    ]);
  });

  it("ignores companion keys of a hidden company field", async () => {
    const hiddenForm: FormEntry = {
      ...companyForm,
      definition: {
        version: 1,
        steps: [
          {
            id: "s",
            fields: [
              {
                id: "f_email",
                name: "email",
                label: "Email",
                type: "email",
                hubspot: { object: "contact", property: "email" },
              },
              {
                id: "f_pro",
                name: "pro",
                label: "Pro ?",
                type: "checkbox",
              },
              {
                ...companyForm.definition.steps[0].fields[1],
                visibleIf: { logic: "and", rules: [{ field: "f_pro", operator: "eq", value: "true" }] },
              },
            ],
          },
        ],
      },
    };
    const { calls } = mockFetch({ sirene: () => ({ status: 200, body: sirenePayload }) });
    const { strapi, rows } = makeStrapi();
    await service(strapi).submit(
      hiddenForm,
      { email: "jane@gmail.com", pro: false, entreprise: "X", entreprise__siret: SIRET },
      meta,
    );
    expect(calls.some((c) => c.path.startsWith("sirene:"))).toBe(false);
    expect(rows[SUBMISSION_UID][0].companies).toEqual([]);
  });

  it("prefers the SIRET dedup over the email-domain dedup when both exist", async () => {
    const { calls } = mockFetch({
      companyFound: true,
      sirene: () => ({ status: 200, body: sirenePayload }),
    });
    const { strapi } = makeStrapi();
    await service(strapi).submit(
      companyForm,
      { email: "jane@acme.com", entreprise: "Test Corp", entreprise__siret: SIRET },
      meta,
    );
    const search = calls.find((c) => c.path.endsWith("/companies/search"));
    expect(JSON.stringify(search?.body)).toContain("siret_custom");
    expect(JSON.stringify(search?.body)).not.toContain("acme.com");
  });
});
