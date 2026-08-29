import * as React from "react";
import { useIntl } from "react-intl";
import {
  Combobox,
  ComboboxOption,
  Field,
  Flex,
  Loader,
} from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { getTranslation } from "../getTranslation";
import { PLUGIN_ID } from "../pluginId";

interface InputProps {
  name: string;
  value?: string;
  onChange: (event: { target: { name: string; value: string; type: string } }) => void;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  labelAction?: React.ReactNode;
  hint?: React.ReactNode;
  label?: string;
}

interface FormOption {
  name: string;
  slug: string;
  published: boolean;
}

/**
 * Picker over the forms built in the HubSpot form builder, for host content
 * that references one (a hero block, a landing…). Stores the form's slug as a
 * plain string: the reference survives the plugin being uninstalled, and a
 * fetch failure degrades to a free-text input rather than blocking the editor.
 *
 * An unpublished form stays selectable — an editor can wire the block before
 * publishing — but is flagged, since the public API only serves published ones.
 */
const HubspotFormInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ name, value, onChange, disabled, error, required, label, hint, labelAction }, ref) => {
    const { formatMessage } = useIntl();
    const { get } = useFetchClient();
    const [forms, setForms] = React.useState<FormOption[] | null>(null);
    const [failed, setFailed] = React.useState(false);

    const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
      formatMessage({ id: getTranslation(id), defaultMessage }, values);

    React.useEffect(() => {
      let cancelled = false;
      get<{ forms: FormOption[] }>(`/${PLUGIN_ID}/forms-options`)
        .then(({ data }) => !cancelled && setForms(data.forms ?? []))
        .catch(() => !cancelled && setFailed(true));
      return () => {
        cancelled = true;
      };
    }, [get]);

    const emit = (next?: string) =>
      onChange({ target: { name, value: next ?? "", type: "string" } });

    // A stored slug whose form was deleted must stay selectable, or saving the
    // entry would silently drop it — flagged instead, like the property picker.
    const known = forms ?? [];
    const orphan = value && !known.some((f) => f.slug === value);

    return (
      <Field.Root name={name} error={error} hint={hint} required={required}>
        <Field.Label action={labelAction}>{label}</Field.Label>

        {failed ? (
          <Field.Input
            ref={ref}
            value={value || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => emit(e.target.value)}
            disabled={disabled}
            placeholder={t("form-picker.fallback", "Form slug")}
          />
        ) : !forms ? (
          <Flex paddingTop={2} paddingBottom={2}>
            <Loader small>{t("form-picker.loading", "Loading the forms…")}</Loader>
          </Flex>
        ) : (
          <Combobox
            ref={ref}
            value={value || ""}
            onChange={(next: string) => emit(next)}
            onClear={() => emit("")}
            disabled={disabled}
            placeholder={t("form-picker.placeholder", "Choose a form…")}
          >
            {orphan && (
              <ComboboxOption value={value!}>
                {t("form-picker.orphan", "{slug} — unknown form", { slug: value! })}
              </ComboboxOption>
            )}
            {known.map((form) => (
              <ComboboxOption key={form.slug} value={form.slug}>
                {form.published
                  ? `${form.name} (${form.slug})`
                  : t("form-picker.draft", "{name} ({slug}) — draft, not served yet", {
                      name: form.name,
                      slug: form.slug,
                    })}
              </ComboboxOption>
            ))}
          </Combobox>
        )}

        <Field.Hint />
        <Field.Error />
      </Field.Root>
    );
  },
);

HubspotFormInput.displayName = "HubspotFormInput";

export default HubspotFormInput;
