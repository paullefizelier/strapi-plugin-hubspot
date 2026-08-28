# Changelog

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
