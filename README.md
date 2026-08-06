# Strapi HubSpot

**Stop typing HubSpot property names from memory.** This plugin turns any CRM
property field in your content types into a searchable picker fed by your actual
portal, and refuses a bad mapping at save time instead of letting it fail
silently three weeks later.

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
that holds the object and choosing *Contact* leaves only contact properties —
the prefix disappears, since it is no longer telling you anything:

```json
{
  "hsProperty": {
    "type": "customField",
    "customField": "plugin::hubspot.property",
    "options": { "objectField": "hsObject" }
  }
}
```

Read-only properties — the ones HubSpot computes and always refuses to
accept — are filtered out, so the list only ever offers things that will
actually work. When the portal id is readable, each selected property gets a
**Voir dans HubSpot** link straight to its settings page.

### Validation on save

Point the plugin at the content types that carry mappings and it walks each
entry before it is written, at any depth — steps, repeatable components, dynamic
zones. An invalid mapping is refused with a message that says which property and
why:

> Mapping HubSpot invalide — « name » existe sur l'objet Société, pas sur Contact

### A settings screen

**Settings → HubSpot** holds the private app token. It is stored server-side and
never returned to the browser: the UI only receives whether a key exists, where
it comes from, and its last four characters. A "Test connection" button
round-trips to HubSpot and reports how many properties it can read.

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
| Property staged in HubSpot but not created yet | The picker accepts a typed value (`creatable`) |
| An object's scope is missing | That object is skipped; the others still work |
| Portal id unreadable | Deep links are omitted; everything else is unaffected |
| Plugin uninstalled | Values remain as strings — nothing to undo |

The property schema is cached for 10 minutes and de-duplicated across concurrent
requests, so a busy Content Manager doesn't hammer the HubSpot API. Saving a new
key drops the cache immediately.

## Admin API

All routes require an authenticated admin.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/hubspot/properties` | Writable properties, readable objects, unreachable ones and the portal id. `?refresh=1` bypasses the cache |
| `GET` | `/hubspot/settings` | Whether a key exists, its source and hint — never the key |
| `PUT` | `/hubspot/settings` | Save a key (`{ apiKey }`) |
| `DELETE` | `/hubspot/settings` | Remove the stored key |

## Compatibility

Strapi **v5**. Node **>= 18**.

## License

MIT
