# Strapi HubSpot

**The form builder for HubSpot** — and the safety net under it.

Build multi-step lead forms in a dedicated admin page: fields mapped to your
portal's *real* CRM properties through a searchable picker, conditional fields
and steps (AND/OR rules re-evaluated server-side), a public API your frontend
renders and posts to, and a submission pipeline that upserts the Contact,
finds-or-creates the Company by corporate domain, drops a recap note on the
timeline, and stores every submission in Strapi whatever the CRM's mood.

Under it, the safety net this plugin has always been: property pickers as
custom fields for your own content types, save-time mapping validation, a
portal-wide audit, and a sending service with retries and a replay queue.

## The form builder

**HubSpot Forms**, in the admin menu (RBAC-gated), is a builder page — not a
Content Manager view. Steps and fields are cards you reorder and configure;
the right-hand panel holds the selected field's settings, including its CRM
mapping picked from the portal (object select, property search, one-click
import of an enumeration's options, deep link to the property).

### Conditional fields and steps

Any field or step can declare `visibleIf`: rules like *[field] [is] [value]*
combined with AND/OR. The editor only offers fields placed **earlier** in the
form, so evaluation is a single deterministic pass. Operators: `eq`, `neq`,
`contains`, `empty`, `notEmpty`, `gt`, `lt`.

Conditions are enforced **server-side at submission**, not just in the UI: a
hidden field loses its `required`, and its value is discarded even if the
browser sent it — the payload that reaches HubSpot is the payload the visitor
actually saw.

### The public API

Two content-api routes (grant them to the Public role in **Settings → Users &
Permissions**):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/hubspot/forms/:slug?locale=` | The published form — meta, steps, fields, conditions. The CRM mapping is stripped: the browser never learns your property names |
| `POST` | `/api/hubspot/forms/:slug/submit` | Validates (bounds, conditions, required), maps server-side, syncs HubSpot, stores the submission |

The submit pipeline, in order: contact upsert (`email` is the find-or-create
key) through the plugin's sending service — pre-validation against the portal
schema (a stale mapping costs one answer, never the lead), retries, replay
queue; then, when the email is on a corporate domain, company found-or-created
by `domain` and associated to the contact; then a timeline note recapping the
answers and the lead's origin. Company and note are best-effort and can be
turned off:

```ts
hubspot: {
  config: {
    forms: {
      companyFromDomain: true, // Company by corporate domain + association
      timelineNote: true,      // recap note on the contact (and company)
    },
  },
}
```

Every submission is stored in **HubSpot form submissions** (Content Manager),
synced or not, with the CRM ids when the sync succeeded — the source of truth
lives in your database, not in HubSpot's availability.

Typed payloads for your frontend:

```ts
import type { PublicForm, SubmitRequest } from "strapi-plugin-hubspot/types";
```

### Importing existing forms

If your forms currently live in a content type (the `steps`/`fields` +
`hsObject`/`hsProperty` shape this README documents below), point the builder
at it:

```ts
hubspot: {
  config: {
    forms: {
      import: {
        uid: "api::form.form",
        // Optional remapping when your attribute names differ:
        // steps: "etapes", fields: "champs",
        // field: { label: "libelle", object: "objet", property: "propriete" },
      },
    },
  },
}
```

The list page then offers **Import an existing form**: one click converts the
entry — every locale — into a builder draft with the same slug. The source is
never modified, re-importing overwrites the draft only, and unpublishing rolls
a migrated form back. Migrate form by form; the validation middleware keeps
protecting the ones that stay.

### i18n and publishing

Forms are draft & publish, localized like your content: `name` and `slug` are
shared, everything else — including the structure — is per-locale. Opening a
locale that doesn't exist yet starts it from the default locale's structure.
Publishing is blocked while a mapping problem remains; drafts save anyway,
with the problem flagged on the field carrying it.

---

## The safety net

## The problem it solves

If you build lead forms in Strapi and push them to HubSpot, somewhere in your
schema there is a field where an editor types a property name — `hs_role`,
`numberofemployees`, `jobtitle`. It is a free-text field, and nothing checks it.

That matters more than it looks, because of how the HubSpot API behaves:

> **A single unknown property makes HubSpot reject the entire upsert.**

So one typo doesn't cost you one answer. It costs you the whole lead. The
submission is accepted by your site, stored in Strapi, and never reaches the
CRM — with no error anyone will notice until someone asks why the pipeline is
empty.

The three ways this happens are all invisible in a text input:

| What you typed | What's wrong |
|---|---|
| `hs_rôle` | Doesn't exist — a typo, an autocorrect, a copy-paste |
| `role ` | Exists, but with a trailing space |
| `name` | Exists, but on **Company** — you mapped it to Contact |

This plugin makes all three impossible to save.

## What you get

### A property picker instead of a text field

Replace your property field's type with the `hubspot.property` custom field.
Editors then search the real, writable properties of your portal:

```
Contact · Rôle (hs_role)
Contact · Prénom (firstname)
Société · Nombre d'employés (numberofemployees)
```

**The list narrows to the object you picked.** Point the field at the sibling
that holds the object — from the Content-Type Builder, under *HubSpot → Object
field* — and choosing *Contact* leaves only contact properties. The prefix
disappears, since it is no longer telling you anything. In `schema.json` that
setting reads:

```json
{
  "hsProperty": {
    "type": "customField",
    "customField": "plugin::hubspot.property",
    "options": { "objectField": "hsObject" }
  }
}
```

Once filtered, the list is ordered and prefixed by the property's **HubSpot
group** — the portal's own way of organising hundreds of properties:

```
Informations de contact · Prénom (firstname)
Informations de contact · Rôle (hs_role)
Historique · Source (hs_analytics_source)
```

Read-only properties — the ones HubSpot computes and always refuses to
accept — are filtered out, so the list only ever offers things that will
actually work. When the portal id is readable, each selected property gets a
**Voir dans HubSpot** link straight to its settings page.

The schema is fetched **once per page** whatever the number of fields, and
cached ten minutes server-side. A property created in HubSpot a minute ago is
one click away: the **↻ button** under any picker re-fetches the portal and
updates every picker on the page at once. And switching a field's object clears
a property that doesn't exist on the new one — it could only fail at save time.

### An object picker to feed it

The sibling object field doesn't have to be a hand-typed enum: the
`hubspot.object` custom field is a select over the portal's configured
objects. An object the token can't read stays selectable, flagged with its
missing scope.

```json
{
  "hsObject": {
    "type": "customField",
    "customField": "plugin::hubspot.object"
  }
}
```

### One-click option import

For an **enumeration** property, the picker shows an *Import the N options
from HubSpot* button that fills the sibling repeatable (default `options`,
entries `{ value, label }` — the same shape the validation reads) with the
enumeration's real choices. The `bad-option` check detects a select that
drifted from the CRM; this is what fixes it. Point `optionsField` (in the
field's HubSpot options, next to `objectField`) at the repeatable if it isn't
called `options`.

### Validation on save

Point the plugin at the content types that carry mappings and it walks each
entry before it is written, at any depth — steps, repeatable components, dynamic
zones. An invalid mapping is refused with a message that says which property and
why:

> Invalid HubSpot mapping — "name" exists on company, not on contact

It catches four things:

| Code | Case |
|---|---|
| `unknown` | The property doesn't exist in the portal |
| `wrong-object` | It exists, but on another object |
| `whitespace` | It exists, but the stored value has surrounding spaces |
| `bad-option` | The field offers a choice the enumeration doesn't accept |

That last one closes a real hole: HubSpot refuses a value outside an
enumeration exactly as hard as it refuses an unknown property, so a select whose
choices drifted from the CRM fails at send time with nothing to show for it.
Point `optionsField` at the repeatable holding the choices (default `options`,
each `{ value?, label? }`) and they are checked too.

Each problem is also carried as a structured code in the error's `details`, so a
host app can localize the message instead of parsing the sentence.

**`unknown` is the one code a legitimate workflow can produce** — a mapping
written before its property was deleted in HubSpot, or content created through
the API against a property staged but not created yet. Set `strict: false` on a
validate target and those pass with a warning in the logs instead of blocking
the save. The other three codes always block, whatever `strict` says: no
workflow produces a wrong object, a trailing space, or a drifted option on
purpose.

### An audit of existing content

Save-time validation only protects entries as they are written. A property
deleted in HubSpot afterwards leaves invalid mappings dormant in content nobody
re-saves — until a submission silently fails. **Settings → HubSpot → Mapping
audit** walks every entry of the validated content types (drafts, every locale,
at any depth) against a freshly fetched schema, and lists each entry the portal
would reject today, linking straight to it in the Content Manager.

The audit reports `unknown` properties even on `strict: false` targets: strict
only decides whether a save is blocked, not whether the mapping would reach the
CRM.

### A sending service

The host app doesn't have to talk to HubSpot itself — the plugin exposes the
upsert, with everything above applied on the way out:

```ts
const result = await strapi.plugin("hubspot").service("submit").upsert({
  object: "contact",
  idProperty: "email", // find-or-create key
  properties: {
    email: "jane@acme.com",
    firstname: "Jane",
    hs_role: "dev;designer", // multi-select values use HubSpot's `;` separator
  },
});
// { ok: true, id: "…" }
// { ok: false, problems: [{ code: "unknown", … }] }  — refused before sending
// { ok: false, queued: true, error: "…" }            — parked for replay
```

The payload is validated against the portal schema **before** it is sent —
the same checks as on save, values coerced to strings, empty ones dropped.
Then:

- a **permanent refusal** (4xx) comes back as `{ ok: false, error }` with
  HubSpot's message — retrying can't fix a wrong payload, so nothing is queued;
- a **transient failure** (429, 5xx, network) is retried twice with backoff,
  then parked in **Content Manager → HubSpot failed submissions** and reported
  as `{ ok: false, queued: true }`.

`service("submit").retryFailures()` replays the queue, oldest first — from a
cron in the host app, or the **Replay now** button in Settings → HubSpot. A
replay that succeeds removes the row; one that keeps failing stays, with its
error and attempt count, until it works or an admin deletes it.

Sending needs write scopes on the token: `crm.objects.contacts.write` (and
its equivalent per object you send to).

### A settings screen

**Settings → HubSpot** holds the private app token. It is stored server-side and
never returned to the browser: the UI only receives whether a key exists, where
it comes from, and its last four characters. A "Test connection" button
round-trips to HubSpot and reports how many properties it can read.

Access is gated by a dedicated RBAC permission — **Settings →
Roles → Plugins → Hubspot**. A role without it neither sees the settings link
nor can call the settings routes; reading properties stays open to every
authenticated admin, since the picker needs it in the Content Manager.

> **On storage:** the key is kept in Strapi's core store, which is **not
> encrypted at rest** — it is readable by anyone with database access. It never
> reaches the browser, but treat it like any other secret in your database. Use
> `HUBSPOT_API_KEY` if your deployment already manages secrets properly.

## Install

```bash
npm install strapi-plugin-hubspot
```

Enable it in `config/plugins.ts`:

```ts
export default ({ env }) => ({
  hubspot: {
    enabled: true,
    config: {
      // Optional — the key can also be set from Settings → HubSpot.
      apiKey: env("HUBSPOT_API_KEY", ""),

      // Optional — objects whose properties are offered.
      // Defaults to ["contact", "company"]. Standard names: contact, company,
      // deal, ticket, product, line_item, quote. A custom object is either its
      // type id, or { name, path } when the two differ.
      objects: ["contact", "company", "deal"],

      // Optional — entries whose mappings are validated on save.
      validate: [
        {
          uid: "api::form.form",
          objectField: "hsObject",     // holds "contact" | "company"
          propertyField: "hsProperty", // holds the property name
          optionsField: "options",     // optional — the field's choices
          strict: true,                // optional — false lets `unknown`
                                       // properties through with a warning
        },
      ],
    },
  },
});
```

Then point your property field at the custom field, in the component or content
type that holds it. `options.objectField` names the sibling holding the object —
omit it and the picker simply lists every object's properties:

```json
{
  "hsProperty": {
    "type": "customField",
    "customField": "plugin::hubspot.property",
    "options": { "objectField": "hsObject" }
  }
}
```

Restart Strapi and hard-refresh the admin.

### The token

Create a **private app** in HubSpot with a read scope per object you list:

- `crm.schemas.contacts.read`
- `crm.schemas.companies.read`
- `crm.schemas.deals.read`, `crm.schemas.custom.read`… as needed

An object the token can't read is **skipped, not fatal**: the picker keeps
working for the others and explains which one is missing a scope. `oauth` is
worth adding too — it exposes the portal id *and the portal's UI host*, which
turn on the *view in HubSpot* links.

### Regions

The REST API is global: `api.hubapi.com` routes by token, whatever the portal's
hosting region. The **web app is not** — an EU-hosted portal lives on
`app-eu1.hubspot.com`. Deep links are built from the `uiDomain` HubSpot reports
for your portal rather than a hardcoded host, so they point at the right region
without any configuration.

The key is resolved in this order, first match wins:

1. saved from **Settings → HubSpot**
2. `config.apiKey` in `config/plugins.ts`
3. the `HUBSPOT_API_KEY` environment variable

## Migrating an existing field

The custom field is backed by a plain `string`. Switching an existing text field
to it needs **no migration**: every value already saved stays valid and
selectable, and uninstalling the plugin leaves readable data behind.

A stored value your portal doesn't recognise — typed before you installed this,
or since deleted in HubSpot — stays selected and is flagged *inconnue du portail*
rather than being silently dropped on the next save.

## How it degrades

A plugin that sits between your editors and their content has to fail quietly.
This one never blocks work:

| Situation | Behaviour |
|---|---|
| No API key configured | The field falls back to a plain text input, with a note explaining why |
| HubSpot unreachable | Saving proceeds; validation is skipped and a warning is logged |
| Property staged in HubSpot but not created yet | Not offered — properties are managed in HubSpot, the picker never invents one. A value already stored (e.g. written via the API) passes the save if the target sets `strict: false` |
| An object's scope is missing | That object is skipped; the others still work |
| Portal id unreadable | Deep links are omitted; everything else is unaffected |
| Plugin uninstalled | Values remain as strings — nothing to undo |

The property schema is cached for 10 minutes and de-duplicated across concurrent
requests, so a busy Content Manager doesn't hammer the HubSpot API. Saving a new
key drops the cache immediately.

## Admin API

All routes require an authenticated admin; the settings routes additionally
require the `plugin::hubspot.settings` RBAC permission.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/hubspot/properties` | Writable properties, readable objects, unreachable ones and the portal id. `?refresh=1` bypasses the cache |
| `GET` | `/hubspot/audit` | Scans every entry of the validated content types and returns the invalid mappings, per entry |
| `GET` | `/hubspot/failures` | Number of parked submissions |
| `POST` | `/hubspot/failures/retry` | Replays the parked submissions and reports the outcome |
| `GET` | `/hubspot/settings` | Whether a key exists, its source and hint — never the key |
| `PUT` | `/hubspot/settings` | Save a key (`{ apiKey }`) |
| `DELETE` | `/hubspot/settings` | Remove the stored key |

## i18n

The admin UI ships in English and French, keyed on the Strapi admin locale.
Server-side error messages stay in English; the structured codes in the
error's `details` are the localization hook for host apps.

## Tests

```bash
npm test
```

Vitest over the server logic: mapping checks, deep collection through dynamic
zones and repeatables, schema loading (cache, concurrent de-duplication,
missing scopes) and the strict/non-strict save middleware.

## Compatibility

Strapi **v5**. Node **>= 18**.

## License

MIT
