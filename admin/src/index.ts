import { PLUGIN_ID } from "./pluginId";

/**
 * Registers two things:
 *
 *  - the `hubspot.property` custom field — a searchable picker fed by the
 *    portal's real schema, in place of a free-text CRM property name;
 *  - a Settings → HubSpot section holding the private app token.
 *
 * NOTE: the Component/Input entries must be async functions returning the
 * module. React.lazy here crashes the admin silently — empty #strapi, no
 * console error — the same trap link-graph hit with its menu link.
 */
export default {
  register(app: {
    customFields: { register: (field: unknown) => void };
    createSettingSection: (
      section: { id: string; intlLabel: { id: string; defaultMessage: string } },
      links: unknown[],
    ) => void;
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

    app.createSettingSection(
      {
        id: PLUGIN_ID,
        intlLabel: { id: `${PLUGIN_ID}.settings.section`, defaultMessage: "HubSpot" },
      },
      [
        {
          intlLabel: { id: `${PLUGIN_ID}.settings.link`, defaultMessage: "Configuration" },
          id: `${PLUGIN_ID}-settings`,
          to: `/settings/${PLUGIN_ID}`,
          permissions: [],
          Component: async () => (await import("./pages/Settings")).default,
        },
      ],
    );

    app.registerPlugin({ id: PLUGIN_ID, name: PLUGIN_ID });
  },
};
