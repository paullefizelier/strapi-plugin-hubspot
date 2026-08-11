/**
 * The dead-letter queue for submissions HubSpot couldn't take: transient
 * failures land here after the in-process retries are exhausted, and
 * `retryFailures()` replays them.
 *
 * Visible in the Content Manager on purpose — an admin can inspect a stuck
 * payload and delete it — but hidden from the Content-Type Builder: its shape
 * belongs to the plugin.
 */
export default {
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
