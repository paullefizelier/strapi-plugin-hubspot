import * as React from "react";
import { Combobox, ComboboxOption, Field, Flex, Loader, Link } from "@strapi/design-system";
import { useFetchClient, useField } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";
import { objectLabel } from "../objectLabels";

interface HsProperty {
  name: string;
  label: string;
  object: string;
  type?: string;
  group?: string;
}

interface SchemaResponse {
  configured: boolean;
  properties: HsProperty[];
  objects: string[];
  unavailable: { object: string; reason: string }[];
  portalId?: number;
}

interface InputProps {
  name: string;
  value?: string;
  onChange: (event: { target: { name: string; value: string; type: string } }) => void;
  attribute?: { options?: { objectField?: string } };
  disabled?: boolean;
  error?: string;
  required?: boolean;
  labelAction?: React.ReactNode;
  hint?: React.ReactNode;
  label?: string;
}

/**
 * Picker over the portal's writable properties, narrowed to the object the
 * sibling field selects.
 *
 * The sibling is found by path arithmetic on our own `name`: inside a repeatable
 * component in a dynamic zone it looks like
 * `blocks.3.form.steps.0.fields.2.hsProperty`, so swapping the last segment
 * yields the neighbour. Which segment to swap is configurable per attribute
 * (`options.objectField`) so the plugin isn't tied to a field called `hsObject`.
 *
 * Before an object is chosen the full list shows, each entry prefixed by its
 * object — an empty picker would read as broken.
 */
const HubspotPropertyInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ name, value, onChange, attribute, disabled, error, required, label, hint, labelAction }, ref) => {
    const { get } = useFetchClient();
    const [schema, setSchema] = React.useState<SchemaResponse | null>(null);
    const [loadError, setLoadError] = React.useState("");

    const objectFieldName = attribute?.options?.objectField || "hsObject";
    const siblingPath = React.useMemo(
      () => name.replace(/[^.]+$/, objectFieldName),
      [name, objectFieldName],
    );
    // Reads the neighbour reactively: switching Contact → Société re-filters the
    // list without remounting the field.
    const siblingField = useField<string>(siblingPath);
    const selectedObject = siblingField?.value;

    React.useEffect(() => {
      let cancelled = false;
      get<SchemaResponse>(`/${PLUGIN_ID}/properties`)
        .then(({ data }) => {
          if (!cancelled) setSchema(data);
        })
        .catch((err: { response?: { data?: { error?: { message?: string } } } }) => {
          if (cancelled) return;
          setSchema({ configured: false, properties: [], objects: [], unavailable: [] });
          setLoadError(err?.response?.data?.error?.message ?? "Propriétés HubSpot indisponibles");
        });
      return () => {
        cancelled = true;
      };
    }, [get]);

    // Combobox hands back `undefined` when cleared — normalize to an empty string
    // so the stored value is always a string.
    const emit = (next?: string) =>
      onChange({ target: { name, value: next ?? "", type: "string" } });

    const options = React.useMemo(() => {
      const all = schema?.properties ?? [];
      const scoped = selectedObject ? all.filter((p) => p.object === selectedObject) : all;
      const shown = scoped.map((p) => ({
        value: p.name,
        // The object prefix is redundant once filtered, and noisy.
        label: selectedObject
          ? `${p.label} (${p.name})`
          : `${objectLabel(p.object)} · ${p.label} (${p.name})`,
      }));
      // A stored value the portal doesn't know (typed before the plugin, since
      // deleted in HubSpot, or belonging to another object) must stay selectable,
      // or saving would silently drop it.
      if (value && !scoped.some((p) => p.name === value)) {
        const elsewhere = all.find((p) => p.name === value);
        shown.unshift({
          value,
          label: elsewhere
            ? `${value} — appartient à ${objectLabel(elsewhere.object)}`
            : `${value} — inconnue du portail`,
        });
      }
      return shown;
    }, [schema, selectedObject, value]);

    const describe = (): React.ReactNode => {
      if (loadError) return loadError;
      if (schema && !schema.configured) {
        return "Aucune clé API HubSpot — saisie libre. Renseignez-la dans Réglages → HubSpot.";
      }
      if (selectedObject && schema?.unavailable.some((u) => u.object === selectedObject)) {
        return `Propriétés de « ${objectLabel(selectedObject)} » illisibles — portée manquante sur le jeton.`;
      }
      return hint;
    };

    /** Deep link to the property in HubSpot, when the portal id is known. */
    const crmLink =
      schema?.portalId && value && schema.properties.some((p) => p.name === value)
        ? `https://app.hubspot.com/property-settings/${schema.portalId}/properties?search=${encodeURIComponent(value)}`
        : null;

    return (
      <Field.Root name={name} error={error} hint={describe()} required={required}>
        <Field.Label action={labelAction}>{label}</Field.Label>

        {!schema ? (
          <Flex paddingTop={2} paddingBottom={2}>
            <Loader small>Chargement des propriétés HubSpot…</Loader>
          </Flex>
        ) : schema.configured ? (
          <Combobox
            ref={ref}
            value={value || ""}
            onChange={emit}
            onClear={() => emit("")}
            disabled={disabled}
            placeholder="Rechercher une propriété…"
            // Lets an editor keep a property staged in HubSpot but not created
            // yet, instead of being locked out.
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

        {crmLink ? (
          <Flex paddingTop={1}>
            <Link href={crmLink} isExternal>
              Voir dans HubSpot
            </Link>
          </Flex>
        ) : null}

        <Field.Hint />
        <Field.Error />
      </Field.Root>
    );
  },
);

HubspotPropertyInput.displayName = "HubspotPropertyInput";

export default HubspotPropertyInput;
