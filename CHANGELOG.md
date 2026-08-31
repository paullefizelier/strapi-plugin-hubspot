# Changelog

## 0.13.0 — 2026-08-31

### Added
- **Drag & drop in the builder** (@dnd-kit): steps reorder among themselves,
  fields reorder within their step — grab the grip handle; an 8px activation
  distance keeps plain clicks selecting as before. The arrow buttons stay:
  they remain the accessible path and the way to slide a field into the
  neighbouring step.

## 0.11.1 — 2026-08-29

Ships the company-search sharpening that missed the 0.11.0 tarball (the
release was published before its PR merged):

- pasted SIRET/SIREN identifiers survive their formatting (spaces, dots,
  dashes) and query directly;
- closed structures excluded at the source (`etat_administratif=A`);
- big groups surface up to 5 matching établissements.

## 0.11.0 — 2026-08-29

### Added — the `company` field (INSEE/SIRENE)
- New field type **`company`**: the visitor picks their company from the
  French SIRENE registry (Recherche d'entreprises API — no key), siège and
  matching établissements offered separately, closed ones filtered. Free text
  stays allowed: an unfindable company submits its typed name alone.
- **The server is the authority**: the browser only nominates a SIRET; at
  submission the plugin re-resolves it against SIRENE and maps fresh data. If
  the API is down, the browser's snapshot is used and flagged unresolved.
- **Per-datum HubSpot mapping** (`companyMap`, server-side only — stripped
  from the public API): legal name, SIRET, SIREN, address, postal code, city,
  is-headquarters, NAF code + label (embedded NAF rev. 2 table), INSEE
  headcount range — each with its own object + property picker in the builder.
- **Company dedup order**: mapped SIRET property → corporate email domain →
  bare creation with the INSEE data. A personal email with a resolved SIRET
  still gets its Company — the exact case the field exists for.
- Rotating **placeholder examples** (`placeholderExamples`, served publicly),
  edited one per line in the builder.
- Public route `GET /api/hubspot/company-search?q=` (bounded, TTL-cached,
  4s timeout) for the frontend autocomplete; timeline note gains a company
  line; submissions store the resolved records (`companies` attribute).
- Structural guard: a field name colliding with a company field's companion
  keys (`<name>__siret`, `<name>__company`) is refused; `companyMap` entries
  are validated against the portal schema like any mapping.

## 0.10.0 — 2026-08-29

### Added — HubSpot-parity condition operators
- `in` / `notIn` ("is any of" / "is none of"): one rule matching several
  values — a multi-select over the referenced field's options in the editor
  (comma-separated input when the field has none). Closes the gap that
  previously required stacking OR'd `eq` rules.
- `notContains`, `startsWith`, `endsWith` — case-insensitive, like `contains`.
- Structural validation flags an `in`/`notIn` rule with no values, like the
  other comparators; switching operator clears the stale value shape.

Frontends mirroring the engine client-side must add the five operators (the
typed `Operator` union in `strapi-plugin-hubspot/types` is the reference —
the server remains the authority at submission either way).

## 0.9.0 — 2026-08-29

### Added
- **Import from HubSpot**: forms built in HubSpot (marketing v3 Forms API,
  `forms` read scope) can be translated into builder drafts — fields, options,
  two-per-row layouts and dependent-field conditions carried over, with a
  **CRM mapping that is valid on arrival** since a HubSpot form field is a CRM
  property. What the builder can't express (file uploads, hidden fields,
  content blocks, GDPR consent, exotic operators) is skipped and **reported**
  after the import instead of silently dropped. Re-importing overwrites the
  draft; the HubSpot original is never touched.
- **Submissions browser**: a Submissions page in the admin (button on the
  forms list + per-form counts in the table) — newest first, filterable by
  form, sync state at a glance, full answers in a modal, and a per-form
  **CSV export** whose columns follow the field order of the form (historical
  keys appended, never dropped).
- Admin routes: `GET/POST /hubspot/builder/import/hubspot`,
  `GET /hubspot/builder/submissions`, `GET /hubspot/builder/submissions/export`
  (all RBAC-gated by `plugin::hubspot.forms`); the forms list now carries a
  `submissions` count per row.

## 0.8.0 — 2026-08-29

### Improved (builder UX pass, from a live session)
- **The whole step card now selects the step** — the click target was the tiny
  "Step N" text, which read as "step titles can't be edited". Inner controls
  stop propagation, so field selection and the action buttons are unaffected.
- Field panel gains the imported-but-invisible settings: **icon**, **answer
  memory (persist)** and **CSS classes**; the step and form panels gain **CSS
  classes** too.
- **Form-level `class`** now exists end to end: content-type attribute, save,
  public API, legacy import (it used to be silently dropped on migration).
- **Duplicate** action on the forms list — every locale of the draft is
  copied under a fresh slug.
- Leaving the editor with unsaved changes now warns before the tab closes.
- Cosmetics: the actions column no longer shows a raw translation key, and the
  structure column pluralizes properly.

## 0.7.0 — 2026-08-29

### Added
- `hubspot.form-picker` custom field: a searchable select over the forms
  built in the builder, storing the chosen form's **slug** as a plain string —
  for host content that references a form (a hero block, a landing…).
  Unpublished forms stay selectable but are flagged; a slug whose form was
  deleted is kept and flagged instead of silently dropped; a fetch failure
  degrades to free text. Fed by `GET /hubspot/forms-options`, open to any
  authenticated admin (the builder itself stays RBAC-gated).

### Fixed
- Removed an accidental self-dependency (`strapi-plugin-hubspot` listed in its
  own `dependencies`) introduced by a stray `npm install`.

## 0.6.1 — 2026-08-28

### Fixed
- **Admin crash on the HubSpot Forms page** ("Error" with no message, from a
  react-router invariant): `react-router-dom` was missing from
  `peerDependencies`, so 0.6.0 shipped its own inlined copy — a second Router
  context the plugin's `<Routes>` could not reach. It is now externalized to
  the host admin's copy, like every other shared library.
- A `check-externals` step now runs on every build and fails when a
  must-be-external library gets inlined, so this class of bug can't ship again.

## 0.6.0 — 2026-08-28

The plugin becomes **the form builder for HubSpot**.

### Added
- `plugin::hubspot.form` content type (draft & publish, i18n) with a versioned
  JSON `definition` — steps → fields → conditions — hidden from the Content
  Manager: the builder is its editor.
- **HubSpot Forms** admin page (new RBAC action `plugin::hubspot.forms`):
  list, create, delete; builder with reorderable step/field cards, a field
  panel reusing the portal pickers (object, property, enumeration option
  import, deep link), and a condition editor (AND/OR, earlier fields only,
  option-aware values).
- Conditional visibility for fields **and steps** — `eq`, `neq`, `contains`,
  `empty`, `notEmpty`, `gt`, `lt` — enforced server-side at submission: hidden
  fields lose `required` and their values never reach the CRM.
- Public content-api routes: `GET /api/hubspot/forms/:slug` (published form,
  CRM mapping stripped) and `POST /api/hubspot/forms/:slug/submit`
  (bounds-checked, conditions re-evaluated, contact upsert through the
  existing retry/replay pipeline, optional company-by-corporate-domain +
  association, optional timeline recap note).
- `plugin::hubspot.submission` collection — every submission stored, synced
  or not, visible in the Content Manager.
- One-click **import** of legacy content-type forms (`forms.import.uid`,
  attribute names remappable) — all locales, same slug, source untouched.
- Structural validation of definitions (duplicate names, forward/unknown
  references, incomplete rules) blocking saves; mapping validation flagging
  drafts and blocking publish.
- `strapi-plugin-hubspot/types` export: typed public payloads for host apps.
- ESLint (typescript-eslint + react-hooks) and a `lint` CI step.

### Config
- New `forms` block: `companyFromDomain` (default `true`), `timelineNote`
  (default `true`), `import` (off unless configured).

## 0.5.0

- Shared schema cache across pickers, refresh button, auto-clear of a
  property orphaned by an object switch.

## 0.4.0

- Sending service (`submit.upsert`) with pre-validation, retries and the
  failed-submissions replay queue; mapping audit; `hubspot.object` custom
  field; enumeration option import; strict/non-strict validate targets;
  admin i18n (en/fr); RBAC-gated settings; CI + npm publish workflows.
