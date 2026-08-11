import * as React from "react";
import { useIntl } from "react-intl";
import { Button, Combobox, ComboboxOption, Field, Flex, Loader, Link, Typography } from "@strapi/design-system";
import { useFetchClient, useField } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";
import { getTranslation } from "../getTranslation";
import { objectLabel } from "../objectLabels";

interface HsProperty {
  name: string;
  label: string;
  object: string;
  type?: string;
  options: { value: string; label?: string }[];
  group?: string;
}

interface SchemaResponse {
  configured: boolean;
  properties: HsProperty[];
  objects: string[];
  unavailable: { object: string; reason: string }[];
  portalId?: number;
  uiDomain?: string;
}

/**
 * Above 100 options with no filter typed, the design system virtualizes the
 * dropdown with a fixed 40px row estimate and no re-measure — a label that
 * wraps to two lines overlaps the next row and gets clipped. One line +
 * ellipsis keeps every row at the height the virtualizer assumes; the full
 * text stays available on hover, and `textValue` keeps the search working.
 */
const oneLine: React.CSSProperties = {
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

interface InputProps {
  name: string;
  value?: string;
  onChange: (event: { target: { name: string; value: string; type: string } }) => void;
  attribute?: { options?: { objectField?: string; optionsField?: string } };
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
    const intl = useIntl();
    const { formatMessage } = intl;
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

    // The repeatable holding the choices this field offers — the import button
    // fills it from the enumeration's real options.
    const optionsFieldName = attribute?.options?.optionsField || "options";
    const optionsPath = React.useMemo(
      () => name.replace(/[^.]+$/, optionsFieldName),
      [name, optionsFieldName],
    );
    const optionsField = useField<unknown>(optionsPath);
    const [imported, setImported] = React.useState(false);

    React.useEffect(() => {
      let cancelled = false;
      get<SchemaResponse>(`/${PLUGIN_ID}/properties`)
        .then(({ data }) => {
          if (!cancelled) setSchema(data);
        })
        .catch((err: { response?: { data?: { error?: { message?: string } } } }) => {
          if (cancelled) return;
          setSchema({ configured: false, properties: [], objects: [], unavailable: [] });
          setLoadError(
            err?.response?.data?.error?.message ??
              formatMessage({
                id: getTranslation("picker.load-error"),
                defaultMessage: "HubSpot properties unavailable",
              }),
          );
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [get]);

    // Combobox hands back `undefined` when cleared — normalize to an empty string
    // so the stored value is always a string.
    const emit = (next?: string) =>
      onChange({ target: { name, value: next ?? "", type: "string" } });

    const options = React.useMemo(() => {
      const all = schema?.properties ?? [];
      const scoped = selectedObject ? all.filter((p) => p.object === selectedObject) : all;
      // Once filtered to one object, its HubSpot group takes over as the
      // locating prefix — the portal's own way of organising hundreds of
      // properties — and the list is ordered by it.
      const sorted = selectedObject
        ? [...scoped].sort(
            (a, b) =>
              (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label),
          )
        : scoped;
      const shown = sorted.map((p) => ({
        value: p.name,
        label: selectedObject
          ? `${p.group ? `${p.group} · ` : ""}${p.label} (${p.name})`
          : `${objectLabel(intl, p.object)} · ${p.label} (${p.name})`,
      }));
      // A stored value the portal doesn't know (typed before the plugin, since
      // deleted in HubSpot, or belonging to another object) must stay selectable,
      // or saving would silently drop it.
      if (value && !scoped.some((p) => p.name === value)) {
        const elsewhere = all.find((p) => p.name === value);
        shown.unshift({
          value,
          label: elsewhere
            ? formatMessage(
                { id: getTranslation("picker.belongs-to"), defaultMessage: "{property} — belongs to {object}" },
                { property: value, object: objectLabel(intl, elsewhere.object) },
              )
            : formatMessage(
                { id: getTranslation("picker.unknown"), defaultMessage: "{property} — unknown to the portal" },
                { property: value },
              ),
        });
      }
      return shown;
    }, [schema, selectedObject, value, intl, formatMessage]);

    const describe = (): React.ReactNode => {
      if (loadError) return loadError;
      if (schema && !schema.configured) {
        return formatMessage({
          id: getTranslation("picker.not-configured"),
          defaultMessage: "No HubSpot API key — free text. Set it in Settings → HubSpot.",
        });
      }
      if (selectedObject && schema?.unavailable.some((u) => u.object === selectedObject)) {
        return formatMessage(
          {
            id: getTranslation("picker.object-unavailable"),
            defaultMessage: "Properties of “{object}” unreadable — missing scope on the token.",
          },
          { object: objectLabel(intl, selectedObject) },
        );
      }
      return hint;
    };

    /**
     * Deep link to the property in HubSpot, when the portal id is known.
     * Built on the portal's own UI host: the REST API is global, but the web app
     * is regional, so `app.hubspot.com` is wrong for an EU- or AP-hosted portal.
     */
    const crmLink =
      schema?.portalId && value && schema.properties.some((p) => p.name === value)
        ? `https://${schema.uiDomain || "app.hubspot.com"}/property-settings/${schema.portalId}/properties?search=${encodeURIComponent(value)}`
        : null;

    const selectedProperty =
      value && schema
        ? schema.properties.find(
            (p) => p.name === value && (!selectedObject || p.object === selectedObject),
          )
        : undefined;

    // The `bad-option` check only *detects* a select whose choices drifted from
    // the enumeration; this closes the loop by writing the real options into
    // the sibling repeatable.
    const importable =
      selectedProperty?.type === "enumeration" && (selectedProperty.options?.length ?? 0) > 0;

    React.useEffect(() => setImported(false), [value]);

    const importOptions = () => {
      if (!selectedProperty || !optionsField) return;
      // The Content Manager keys repeatable rows on __temp_key__ (fractional
      // indexing); providing them keeps the rows renderable, and the CM strips
      // them before saving.
      const rows = selectedProperty.options.map((o, i) => ({
        __temp_key__: `a${i}`,
        value: o.value,
        label: o.label ?? o.value,
      }));
      optionsField.onChange({
        target: { name: optionsPath, value: rows, type: "json" },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
      setImported(true);
    };

    return (
      <Field.Root name={name} error={error} hint={describe()} required={required}>
        <Field.Label action={labelAction}>{label}</Field.Label>

        {!schema ? (
          <Flex paddingTop={2} paddingBottom={2}>
            <Loader small>
              {formatMessage({
                id: getTranslation("picker.loading"),
                defaultMessage: "Loading HubSpot properties…",
              })}
            </Loader>
          </Flex>
        ) : schema.configured ? (
          <Combobox
            ref={ref}
            value={value || ""}
            onChange={emit}
            onClear={() => emit("")}
            disabled={disabled}
            placeholder={formatMessage({
              id: getTranslation("picker.placeholder"),
              defaultMessage: "Search a property…",
            })}
            // Lets an editor keep a property staged in HubSpot but not created
            // yet, instead of being locked out.
            creatable
            onCreateOption={emit}
          >
            {options.map((o) => (
              <ComboboxOption key={o.value} value={o.value} textValue={o.label}>
                <span title={o.label} style={oneLine}>
                  {o.label}
                </span>
              </ComboboxOption>
            ))}
          </Combobox>
        ) : (
          <Field.Input
            ref={ref}
            value={value || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => emit(e.target.value)}
            disabled={disabled}
            placeholder={formatMessage({
              id: getTranslation("picker.free-placeholder"),
              defaultMessage: "e.g. hs_role, numberofemployees",
            })}
          />
        )}

        {crmLink || importable ? (
          <Flex paddingTop={1} gap={3} alignItems="center" wrap="wrap">
            {importable ? (
              <Button variant="tertiary" size="S" onClick={importOptions} disabled={disabled}>
                {formatMessage(
                  {
                    id: getTranslation("picker.import"),
                    defaultMessage: "Import the {count} options from HubSpot",
                  },
                  { count: selectedProperty?.options.length ?? 0 },
                )}
              </Button>
            ) : null}
            {imported ? (
              <Typography variant="pi" textColor="success600">
                {formatMessage({
                  id: getTranslation("picker.imported"),
                  defaultMessage: "Options imported — save to keep them.",
                })}
              </Typography>
            ) : null}
            {crmLink ? (
              <Link href={crmLink} isExternal>
                {formatMessage({
                  id: getTranslation("picker.view"),
                  defaultMessage: "View in HubSpot",
                })}
              </Link>
            ) : null}
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
