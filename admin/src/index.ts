import { PLUGIN_ID } from "./pluginId";

/**
 * Registers the `hubspot.property` custom field: a searchable picker fed by the
 * portal's real schema, in place of a free-text CRM property name.
 *
 * NOTE: the Input component must be an async function returning the module —
 * React.lazy here crashes the admin silently (same trap as link-graph's menu link).
 */
export default {
  register(app: {
    customFields: { register: (field: unknown) => void };
    registerPlugin: (plugin: { id: string; name: string }) => void;
  }) {
    app.customFields.register({
      name: "property",
      pluginId: PLUGIN_ID,
      type: "string",
      intlLabel: {
        id: `${PLUGIN_ID}.property.label`,
        defaultMessage: "Propriété HubSpot",
      },
      intlDescription: {
        id: `${PLUGIN_ID}.property.description`,
        defaultMessage: "Choisie dans les propriétés réelles du portail",
      },
      components: {
        Input: async () => import("./components/HubspotPropertyInput"),
      },
      options: {},
    });

    app.registerPlugin({ id: PLUGIN_ID, name: PLUGIN_ID });
  },
};
