import { PLUGIN_ID } from "./pluginId";
import { prefixPluginTranslations } from "./getTranslation";

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
        defaultMessage: "HubSpot property",
      },
      intlDescription: {
        id: `${PLUGIN_ID}.property.description`,
        defaultMessage: "Picked from the portal's real properties",
      },
      components: {
        Input: async () => import("./components/HubspotPropertyInput"),
      },
      // Exposed in the Content-Type Builder. Without this, `objectField` could
      // only be set by hand-editing schema.json — which is not how anyone
      // installing from npm adds a field, so the filtering would be unreachable.
      options: {
        base: [
          {
            sectionTitle: {
              id: `${PLUGIN_ID}.options.section`,
              defaultMessage: "HubSpot",
            },
            items: [
              {
                name: "options.objectField",
                type: "text",
                intlLabel: {
                  id: `${PLUGIN_ID}.options.objectField.label`,
                  defaultMessage: "Object field",
                },
                description: {
                  id: `${PLUGIN_ID}.options.objectField.description`,
                  defaultMessage:
                    "Name of the sibling field holding the HubSpot object (e.g. hsObject). Leave empty to list every object's properties.",
                },
                placeholder: {
                  id: `${PLUGIN_ID}.options.objectField.placeholder`,
                  defaultMessage: "hsObject",
                },
              },
            ],
          },
        ],
      },
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
          // Mirrors the RBAC action registered server-side: a role without it
          // doesn't see the link at all — the routes refuse it anyway.
          permissions: [{ action: `plugin::${PLUGIN_ID}.settings`, subject: null }],
          Component: async () => (await import("./pages/Settings")).default,
        },
      ],
    );

    app.registerPlugin({ id: PLUGIN_ID, name: PLUGIN_ID });
  },

  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data: prefixPluginTranslations(data), locale };
        } catch {
          return { data: {}, locale };
        }
      }),
    );
  },
};
