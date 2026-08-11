import { PLUGIN_ID } from "./pluginId";

/** The translation files are unprefixed; every id used at runtime carries the plugin id. */
export const getTranslation = (id: string) => `${PLUGIN_ID}.${id}`;

export const prefixPluginTranslations = (
  trad: Record<string, string>,
): Record<string, string> =>
  Object.fromEntries(Object.entries(trad).map(([key, value]) => [getTranslation(key), value]));
