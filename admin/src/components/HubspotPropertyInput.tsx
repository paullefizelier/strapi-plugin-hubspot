import * as React from "react";
import { Combobox, ComboboxOption, Field, Flex, Loader } from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";

interface HsProperty {
  name: string;
  label: string;
  object: "contact" | "company";
  type?: string;
  group?: string;
}

interface InputProps {
  name: string;
  value?: string;
  onChange: (event: { target: { name: string; value: string; type: string } }) => void;
  attribute?: unknown;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  labelAction?: React.ReactNode;
  hint?: React.ReactNode;
  label?: string;
  placeholder?: string;
}

const OBJECT_LABEL: Record<HsProperty["object"], string> = {
  contact: "Contact",
  company: "Société",
};

/**
 * Picker over the portal's writable properties.
 *
 * Contact and company properties share one list, each prefixed by its object,
 * rather than being filtered by a sibling `hsObject` field: reading a sibling
 * value from inside a repeatable component nested in a dynamic zone is brittle,
 * and showing the object inline is arguably clearer anyway — the editor sees at
 * a glance which record the answer lands on.
 *
 * Falls back to a plain text input when no API key is configured, so the field
 * never blocks authoring on a fresh install.
 */
const HubspotPropertyInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ name, value, onChange, disabled, error, required, label, hint, labelAction }, ref) => {
    const { get } = useFetchClient();
    const [properties, setProperties] = React.useState<HsProperty[]>([]);
    const [configured, setConfigured] = React.useState<boolean | null>(null);
    const [loadError, setLoadError] = React.useState<string>("");

    React.useEffect(() => {
      let cancelled = false;
      get<{ configured: boolean; properties: HsProperty[] }>(`/${PLUGIN_ID}/properties`)
        .then(({ data }) => {
          if (cancelled) return;
          setConfigured(data.configured);
          setProperties(data.properties ?? []);
        })
        .catch((err: { response?: { data?: { error?: { message?: string } } } }) => {
          if (cancelled) return;
          setConfigured(false);
          setLoadError(
            err?.response?.data?.error?.message ?? "Propriétés HubSpot indisponibles",
          );
        });
      return () => {
        cancelled = true;
      };
    }, [get]);

    // Combobox hands back `undefined` when cleared — normalize to an empty string
    // so the stored value is always a string.
    const emit = (next?: string) =>
      onChange({ target: { name, value: next ?? "", type: "string" } });

    const describe = (): React.ReactNode => {
      if (loadError) return loadError;
      if (configured === false) {
        return "Aucune clé API HubSpot — saisie libre. Renseignez-la dans Réglages → HubSpot.";
      }
      return hint;
    };

    // A stored value the portal doesn't know (typed before the plugin, or since
    // deleted in HubSpot) must stay selectable, or saving would silently drop it.
    const options = React.useMemo(() => {
      const known = properties.map((p) => ({
        value: p.name,
        label: `${OBJECT_LABEL[p.object]} · ${p.label} (${p.name})`,
      }));
      if (value && !properties.some((p) => p.name === value)) {
        known.unshift({ value, label: `${value} — inconnue du portail` });
      }
      return known;
    }, [properties, value]);

    return (
      <Field.Root name={name} error={error} hint={describe()} required={required}>
        <Field.Label action={labelAction}>{label}</Field.Label>

        {configured === null ? (
          <Flex paddingTop={2} paddingBottom={2}>
            <Loader small>Chargement des propriétés HubSpot…</Loader>
          </Flex>
        ) : configured ? (
          <Combobox
            ref={ref}
            value={value || ""}
            onChange={emit}
            onClear={() => emit("")}
            disabled={disabled}
            placeholder="Rechercher une propriété…"
            // Lets an editor keep a property that isn't in the portal yet
            // (staged CRM change) instead of being locked out.
            creatable
            onCreateOption={emit}
          >
            {options.map((o) => (
              <ComboboxOption key={o.value} value={o.value}>
                {o.label}
              </ComboboxOption>
            ))}
          </Combobox>
        ) : (
          <Field.Input
            ref={ref}
            value={value || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => emit(e.target.value)}
            disabled={disabled}
            placeholder="ex. hs_role, numberofemployees"
          />
        )}

        <Field.Hint />
        <Field.Error />
      </Field.Root>
    );
  },
);

HubspotPropertyInput.displayName = "HubspotPropertyInput";

export default HubspotPropertyInput;
