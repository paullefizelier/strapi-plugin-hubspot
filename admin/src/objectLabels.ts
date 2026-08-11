import type { IntlShape } from "react-intl";
import { getTranslation } from "./getTranslation";

/**
 * Display names for HubSpot objects.
 *
 * The server returns raw object names (`contact`, `line_item`, or a custom
 * object type id) and stays language-agnostic; naming them is the admin's job,
 * through the plugin's translations. An object with no entry — a custom one —
 * falls back to its own name rather than showing nothing.
 */
const STANDARD = new Set([
  "contact",
  "company",
  "deal",
  "ticket",
  "product",
  "line_item",
  "quote",
]);

export function objectLabel(intl: IntlShape, object: string): string {
  return STANDARD.has(object)
    ? intl.formatMessage({ id: getTranslation(`objects.${object}`), defaultMessage: object })
    : object;
}
