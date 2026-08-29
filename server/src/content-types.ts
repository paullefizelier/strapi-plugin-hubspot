/**
 * The dead-letter queue for submissions HubSpot couldn't take: transient
 * failures land here after the in-process retries are exhausted, and
 * `retryFailures()` replays them.
 *
 * Visible in the Content Manager on purpose — an admin can inspect a stuck
 * payload and delete it — but hidden from the Content-Type Builder: its shape
 * belongs to the plugin.
 */
/** A localized string attribute of the form content type. */
const localizedString = (type: "string" | "text" = "string") => ({
  type,
  pluginOptions: { i18n: { localized: true } },
});

export default {
  /**
   * A form built in the plugin's builder page. The flat, queryable identity
   * lives as attributes; the structure (steps → fields → conditions) lives in
   * `definition`, a versioned JSON document — plugins cannot ship components,
   * and the builder is a better editor for it than the Content Manager, which
   * is why the type is hidden there.
   */
  form: {
    schema: {
      kind: "collectionType",
      collectionName: "hubspot_forms",
      info: {
        singularName: "form",
        pluralName: "forms",
        displayName: "HubSpot forms",
        description: "Forms built in the HubSpot form builder",
      },
      options: { draftAndPublish: true },
      pluginOptions: {
        "content-manager": { visible: false },
        "content-type-builder": { visible: false },
        i18n: { localized: true },
      },
      attributes: {
        name: {
          type: "string",
          required: true,
          pluginOptions: { i18n: { localized: false } },
        },
        slug: {
          type: "uid",
          targetField: "name",
          required: true,
        },
        title: localizedString(),
        subtitle: localizedString("text"),
        nextLabel: localizedString(),
        submitLabel: localizedString(),
        successMessage: localizedString("text"),
        class: { type: "string" },
        definition: {
          type: "json",
          required: true,
          pluginOptions: { i18n: { localized: true } },
        },
      },
    },
  },

  /**
   * One visitor submission of a built form — the source of truth for the
   * lead, stored whatever the CRM's mood. Visible in the Content Manager so
   * the team can browse and export; hidden from the Content-Type Builder.
   */
  submission: {
    schema: {
      kind: "collectionType",
      collectionName: "hubspot_submissions",
      info: {
        singularName: "submission",
        pluralName: "submissions",
        displayName: "HubSpot form submissions",
        description: "Visitor submissions of the forms built with the plugin",
      },
      options: { draftAndPublish: false },
      pluginOptions: {
        "content-manager": { visible: true },
        "content-type-builder": { visible: false },
      },
      attributes: {
        form: { type: "string", required: true },
        formTitle: { type: "string" },
        email: { type: "email" },
        values: { type: "json", required: true },
        meta: { type: "json" },
        locale: { type: "string" },
        hubspotSynced: { type: "boolean", default: false },
        contactId: { type: "string" },
        companyId: { type: "string" },
        rejected: { type: "json" },
        companies: { type: "json" },
      },
    },
  },

  failure: {
    schema: {
      kind: "collectionType",
      collectionName: "hubspot_failures",
      info: {
        singularName: "failure",
        pluralName: "failures",
        displayName: "HubSpot failed submissions",
        description: "Submissions HubSpot couldn't take, waiting to be replayed",
      },
      options: { draftAndPublish: false },
      pluginOptions: {
        "content-manager": { visible: true },
        "content-type-builder": { visible: false },
      },
      attributes: {
        object: { type: "string", required: true },
        idProperty: { type: "string", required: true },
        properties: { type: "json", required: true },
        error: { type: "text" },
        attempts: { type: "integer", default: 1 },
      },
    },
  },
};
