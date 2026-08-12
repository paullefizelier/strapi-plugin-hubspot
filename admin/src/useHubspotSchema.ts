import * as React from "react";
import { useFetchClient } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "./pluginId";

export interface HsProperty {
  name: string;
  label: string;
  object: string;
  type?: string;
  options: { value: string; label?: string }[];
  group?: string;
}

export interface SchemaResponse {
  configured: boolean;
  properties: HsProperty[];
  objects: string[];
  unavailable: { object: string; reason: string }[];
  portalId?: number;
  uiDomain?: string;
}

/**
 * One schema for every mounted picker.
 *
 * A form entry mounts one property picker and one object picker per field —
 * twenty fields would mean forty identical requests on open. The cache is
 * module-level: the first mount fetches, everyone else reuses, and a refresh
 * (the ↻ button) notifies every mounted instance so the whole form sees the
 * new property at once.
 */
let cached: SchemaResponse | null = null;
let inFlight: Promise<SchemaResponse> | null = null;
const listeners = new Set<(schema: SchemaResponse) => void>();

const EMPTY: SchemaResponse = {
  configured: false,
  properties: [],
  objects: [],
  unavailable: [],
};

const messageOf = (err: unknown): string | undefined =>
  (err as { response?: { data?: { error?: { message?: string } } } })?.response
    ?.data?.error?.message;

export function useHubspotSchema() {
  const { get } = useFetchClient();
  const [schema, setSchema] = React.useState<SchemaResponse | null>(cached);
  // `null` = no error; `""` = failed without a server message.
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(
    async (refresh: boolean) => {
      if (!refresh && cached) return;
      if (refresh) setRefreshing(true);
      if (refresh || !inFlight) {
        inFlight = get<SchemaResponse>(
          `/${PLUGIN_ID}/properties${refresh ? "?refresh=1" : ""}`,
        ).then(({ data }) => data);
      }
      const request = inFlight;
      try {
        const data = await request;
        cached = data;
        setLoadError(null);
        for (const notify of listeners) notify(data);
      } catch (err) {
        // Degrade this instance to free text rather than blocking the editor;
        // a later mount will simply try again.
        setSchema((current) => current ?? EMPTY);
        setLoadError(messageOf(err) ?? "");
      } finally {
        if (inFlight === request) inFlight = null;
        setRefreshing(false);
      }
    },
    [get],
  );

  React.useEffect(() => {
    const notify = (data: SchemaResponse) => setSchema(data);
    listeners.add(notify);
    if (cached) setSchema(cached);
    load(false);
    return () => {
      listeners.delete(notify);
    };
  }, [load]);

  const refresh = React.useCallback(() => load(true), [load]);

  return { schema, loadError, refresh, refreshing };
}
