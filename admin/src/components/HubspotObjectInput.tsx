import * as React from "react";
import { useIntl } from "react-intl";
import { Field, Flex, Loader, SingleSelect, SingleSelectOption } from "@strapi/design-system";
import { getTranslation } from "../getTranslation";
import { objectLabel } from "../objectLabels";
import { useHubspotSchema } from "../useHubspotSchema";

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

/**
 * Picker over the portal's configured objects — the companion of the property
 * picker. Without it the object field is a hand-typed enum in schema.json,
 * which is exactly the class of mistake this plugin exists to remove.
 *
 * Objects the token can't read stay selectable, flagged: a missing scope is a
 * portal configuration problem, not a reason to lock the schema author out.
 */
const HubspotObjectInput = React.forwardRef<HTMLDivElement, InputProps>(
  ({ name, value, onChange, disabled, error, required, label, hint, labelAction }, ref) => {
    const intl = useIntl();
    const { formatMessage } = intl;
    // Shared with every other picker on the page — one request per form, and a
    // ↻ refresh from any property field updates this list too.
    const { schema } = useHubspotSchema();

    const emit = (next?: string | number) =>
      onChange({ target: { name, value: String(next ?? ""), type: "string" } });

    const known = [
      ...(schema?.objects ?? []),
      ...(schema?.unavailable ?? []).map((u) => u.object),
    ];
    // A stored value outside the configured objects must stay selectable, or
    // saving the entry would silently drop it.
    const options = value && !known.includes(value) ? [value, ...known] : known;

    return (
      <Field.Root name={name} error={error} hint={hint} required={required}>
        <Field.Label action={labelAction}>{label}</Field.Label>

        {!schema ? (
          <Flex paddingTop={2} paddingBottom={2}>
            <Loader small>
              {formatMessage({
                id: getTranslation("object.loading"),
                defaultMessage: "Loading HubSpot objects…",
              })}
            </Loader>
          </Flex>
        ) : schema.configured ? (
          <SingleSelect
            ref={ref}
            value={value || ""}
            onChange={emit}
            onClear={() => emit("")}
            disabled={disabled}
            placeholder={formatMessage({
              id: getTranslation("object.placeholder"),
              defaultMessage: "Choose an object…",
            })}
          >
            {options.map((object) => (
              <SingleSelectOption key={object} value={object}>
                {schema.unavailable.some((u) => u.object === object)
                  ? formatMessage(
                      {
                        id: getTranslation("object.no-scope"),
                        defaultMessage: "{object} — missing scope on the token",
                      },
                      { object: objectLabel(intl, object) },
                    )
                  : objectLabel(intl, object)}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        ) : (
          <Field.Input
            ref={ref as unknown as React.Ref<HTMLInputElement>}
            value={value || ""}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => emit(e.target.value)}
            disabled={disabled}
            placeholder="contact"
          />
        )}

        <Field.Hint />
        <Field.Error />
      </Field.Root>
    );
  },
);

HubspotObjectInput.displayName = "HubspotObjectInput";

export default HubspotObjectInput;
