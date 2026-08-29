import * as React from "react";
import { useIntl } from "react-intl";
import {
  Box,
  Button,
  Checkbox,
  Combobox,
  ComboboxOption,
  Divider,
  Field,
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from "@strapi/design-system";
import { ArrowClockwise, Plus, Trash } from "@strapi/icons";
import { getTranslation } from "../getTranslation";
import { objectLabel } from "../objectLabels";
import { useHubspotSchema } from "../useHubspotSchema";
import CompanyMapEditor from "./CompanyMapEditor";
import ConditionEditor from "./ConditionEditor";
import { FIELD_TYPES, type CompanyMap, type FieldType, type FormField, type MappingProblem } from "./types";

interface Props {
  field: FormField;
  /** Fields before this one — what its condition may read. */
  candidates: FormField[];
  problem?: MappingProblem;
  onChange: (patch: Partial<FormField>) => void;
}

const slugifyName = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * Everything about the selected field: identity, behaviour, options, the CRM
 * mapping (object picker + property picker fed by the portal, one-click
 * option import for enumerations) and its visibility condition.
 */
const FieldPanel = ({ field, candidates, problem, onChange }: Props) => {
  const intl = useIntl();
  const { formatMessage } = intl;
  const { schema, refresh, refreshing } = useHubspotSchema();
  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const object = field.hubspot?.object || "contact";
  const properties = (schema?.properties ?? []).filter((p) => p.object === object);
  const selected = properties.find((p) => p.name === field.hubspot?.property);
  const isChoice = field.type === "select" || field.type === "radio";
  const isCompany = field.type === "company";

  /** Sensible pre-mapping when a field becomes a company field. */
  const DEFAULT_COMPANY_MAP: CompanyMap = {
    name: { object: "company", property: "name" },
    address: { object: "company", property: "address" },
    zip: { object: "company", property: "zip" },
    city: { object: "company", property: "city" },
  };

  const setHubspot = (patch: Partial<NonNullable<FormField["hubspot"]>>) =>
    onChange({ hubspot: { ...field.hubspot, ...patch } });

  const importOptions = () => {
    if (!selected?.options?.length) return;
    onChange({
      options: selected.options.map((o) => ({ value: o.value, label: o.label ?? o.value })),
    });
  };

  const deepLink =
    schema?.portalId && schema?.uiDomain && selected
      ? `https://${schema.uiDomain}/property-settings/${schema.portalId}/properties?type=0-${
          { contact: 1, company: 2, deal: 3, ticket: 5 }[object] ?? 1
        }&search=${encodeURIComponent(selected.name)}`
      : null;

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Field.Root>
        <Field.Label>{t("panel.label", "Label")}</Field.Label>
        <TextInput
          value={field.label}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const label = e.target.value;
            // The payload key follows the label until it was edited by hand.
            const auto = !field.name || field.name === slugifyName(field.label);
            onChange({ label, ...(auto ? { name: slugifyName(label) } : {}) });
          }}
        />
      </Field.Root>

      <Field.Root>
        <Field.Label>{t("panel.name", "Payload key")}</Field.Label>
        <TextInput
          value={field.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange({ name: slugifyName(e.target.value) || e.target.value })
          }
        />
        <Typography variant="pi" textColor="neutral600">
          {t("panel.name-hint", "Key of the answer in the submission — unique in the form.")}
        </Typography>
      </Field.Root>

      <Field.Root>
        <Field.Label>{t("panel.type", "Type")}</Field.Label>
        <SingleSelect
          value={field.type}
          onChange={(v: string | number) =>
            onChange({
              type: v as FieldType,
              ...(v === "company" && !field.companyMap ? { companyMap: DEFAULT_COMPANY_MAP } : {}),
            })
          }
        >
          {FIELD_TYPES.map((type) => (
            <SingleSelectOption key={type} value={type}>
              {type}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Field.Root>

      <Flex gap={4}>
        <Box flex="1">
          <Field.Root>
            <Field.Label>
              {isCompany
                ? t("company.examples", "Placeholder examples (one per line)")
                : t("panel.placeholder", "Placeholder")}
            </Field.Label>
            {isCompany ? (
              <Textarea
                value={(field.placeholderExamples ?? []).join("\n")}
                placeholder={t(
                  "company.examples-placeholder",
                  "Ex. : un établissement d'un grand groupe\nEx. : le siège de votre PME",
                )}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  onChange({
                    placeholderExamples: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  })
                }
              />
            ) : (
              <TextInput
                value={field.placeholder ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange({ placeholder: e.target.value })
                }
              />
            )}
          </Field.Root>
        </Box>
        <Box flex="1">
          <Field.Root>
            <Field.Label>{t("panel.width", "Width")}</Field.Label>
            <SingleSelect
              value={field.width ?? "full"}
              onChange={(v: string | number) => onChange({ width: v as "full" | "half" })}
            >
              <SingleSelectOption value="full">{t("panel.width-full", "Full")}</SingleSelectOption>
              <SingleSelectOption value="half">{t("panel.width-half", "Half")}</SingleSelectOption>
            </SingleSelect>
          </Field.Root>
        </Box>
      </Flex>

      <Field.Root>
        <Field.Label>{t("panel.help", "Help text")}</Field.Label>
        <TextInput
          value={field.helpText ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ helpText: e.target.value })}
        />
      </Field.Root>

      <Checkbox
        checked={Boolean(field.required)}
        onCheckedChange={(checked: boolean | "indeterminate") =>
          onChange({ required: checked === true })
        }
      >
        {t("panel.required", "Required")}
      </Checkbox>

      <Flex gap={4}>
        <Box flex="1">
          <Field.Root>
            <Field.Label>{t("panel.icon", "Icon")}</Field.Label>
            <TextInput
              value={(field.icon as string) ?? ""}
              placeholder="i-lucide-building-2"
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ icon: e.target.value })}
            />
          </Field.Root>
        </Box>
        <Box flex="1">
          <Field.Root>
            <Field.Label>{t("panel.persist", "Answer memory")}</Field.Label>
            <SingleSelect
              value={(field.persist as string) ?? "session"}
              onChange={(v: string | number) =>
                onChange({ persist: v as "session" | "days30" })
              }
            >
              <SingleSelectOption value="session">
                {t("panel.persist-session", "This visit only")}
              </SingleSelectOption>
              <SingleSelectOption value="days30">
                {t("panel.persist-days30", "30 days (non-identifying fields only)")}
              </SingleSelectOption>
            </SingleSelect>
          </Field.Root>
        </Box>
      </Flex>

      <Field.Root>
        <Field.Label>{t("panel.class", "CSS classes")}</Field.Label>
        <TextInput
          value={(field.class as string) ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ class: e.target.value })}
        />
      </Field.Root>

      {isChoice && (
        <Flex direction="column" alignItems="stretch" gap={2}>
          <Typography variant="sigma" textColor="neutral600">
            {t("panel.options", "Choices")}
          </Typography>
          {(field.options ?? []).map((option, index) => (
            <Flex key={index} gap={2}>
              <TextInput
                aria-label={t("panel.option-value", "Value")}
                placeholder={t("panel.option-value", "Value")}
                value={option.value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange({
                    options: (field.options ?? []).map((o, i) =>
                      i === index ? { ...o, value: e.target.value } : o,
                    ),
                  })
                }
              />
              <TextInput
                aria-label={t("panel.option-label", "Label")}
                placeholder={t("panel.option-label", "Label")}
                value={option.label ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange({
                    options: (field.options ?? []).map((o, i) =>
                      i === index ? { ...o, label: e.target.value } : o,
                    ),
                  })
                }
              />
              <IconButton
                label={t("panel.option-remove", "Remove")}
                onClick={() =>
                  onChange({ options: (field.options ?? []).filter((_, i) => i !== index) })
                }
              >
                <Trash />
              </IconButton>
            </Flex>
          ))}
          <Flex gap={2}>
            <Button
              variant="tertiary"
              size="S"
              startIcon={<Plus />}
              onClick={() => onChange({ options: [...(field.options ?? []), { value: "", label: "" }] })}
            >
              {t("panel.option-add", "Add a choice")}
            </Button>
            {selected?.type === "enumeration" && Boolean(selected.options?.length) && (
              <Button variant="secondary" size="S" onClick={importOptions}>
                {t("panel.option-import", "Import the {count} options from HubSpot", {
                  count: selected.options.length,
                })}
              </Button>
            )}
          </Flex>
        </Flex>
      )}

      <Divider />

      <Flex direction="column" alignItems="stretch" gap={2}>
        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="sigma" textColor="neutral600">
            {isCompany
              ? t("company.section", "Company data (INSEE → HubSpot)")
              : t("panel.hubspot", "HubSpot")}
          </Typography>
          <IconButton
            label={t("panel.refresh", "Refresh the portal schema")}
            onClick={refresh}
            disabled={refreshing}
          >
            <ArrowClockwise />
          </IconButton>
        </Flex>

        {isCompany && (
          <>
            <Typography variant="pi" textColor="neutral600">
              {t(
                "company.section-hint",
                "The visitor picks their company from the SIRENE registry; the server re-resolves the SIRET and sends each datum below to its property.",
              )}
            </Typography>
            <CompanyMapEditor
              map={field.companyMap ?? {}}
              onChange={(companyMap) => onChange({ companyMap })}
            />
          </>
        )}

        {!isCompany && (
        <Field.Root>
          <Field.Label>{t("panel.object", "Object")}</Field.Label>
          <SingleSelect
            value={object}
            onChange={(v: string | number) => {
              // A property never survives an object switch — it belongs to one.
              setHubspot({ object: String(v), property: undefined });
            }}
          >
            {(schema?.objects ?? ["contact", "company"]).map((name) => (
              <SingleSelectOption key={name} value={name}>
                {objectLabel(intl, name)}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Field.Root>
        )}

        {!isCompany && (
        <Field.Root>
          <Field.Label>{t("panel.property", "Property")}</Field.Label>
          <Combobox
            value={field.hubspot?.property ?? ""}
            onChange={(v: string) => setHubspot({ property: v || undefined })}
            onClear={() => setHubspot({ property: undefined })}
            placeholder={t("panel.property-placeholder", "Search a property…")}
          >
            {properties.map((p) => (
              <ComboboxOption key={p.name} value={p.name}>
                {p.group ? `${p.group} · ` : ""}
                {p.label} ({p.name})
              </ComboboxOption>
            ))}
          </Combobox>
          {problem && (
            <Typography variant="pi" textColor="danger600">
              {t(`panel.problem-${problem.code}`, "Invalid mapping ({code})", {
                code: problem.code,
              })}
            </Typography>
          )}
          {!field.hubspot?.property && (
            <Typography variant="pi" textColor="neutral600">
              {t("panel.property-hint", "Without a property, the answer is sent under the payload key.")}
            </Typography>
          )}
        </Field.Root>
        )}

        {!isCompany && deepLink && (
          <a href={deepLink} target="_blank" rel="noreferrer">
            <Typography variant="pi" textColor="primary600">
              {t("panel.view-in-hubspot", "View in HubSpot ↗")}
            </Typography>
          </a>
        )}
      </Flex>

      <Divider />

      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="sigma" textColor="neutral600">
          {t("panel.condition", "Show this field only when…")}
        </Typography>
        <ConditionEditor
          condition={field.visibleIf}
          candidates={candidates}
          onChange={(visibleIf) => onChange({ visibleIf })}
        />
      </Flex>
    </Flex>
  );
};

export default FieldPanel;
