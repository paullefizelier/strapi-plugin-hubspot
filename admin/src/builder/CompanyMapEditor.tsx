import * as React from "react";
import { useIntl } from "react-intl";
import {
  Box,
  Combobox,
  ComboboxOption,
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from "@strapi/design-system";
import { Plus, Trash } from "@strapi/icons";
import { getTranslation } from "../getTranslation";
import { objectLabel } from "../objectLabels";
import { useHubspotSchema } from "../useHubspotSchema";
import { COMPANY_DATA, type CompanyDatum, type CompanyMap } from "./types";

interface Props {
  map: CompanyMap;
  onChange: (map: CompanyMap) => void;
}

/**
 * The company field's mapping table: one row per SIRENE datum the editor
 * chose to send — object select + property picker, fed by the same portal
 * schema as every other picker. Only mapped rows render (the sidebar is
 * 380px); the rest live behind the "add" select.
 */
const CompanyMapEditor = ({ map, onChange }: Props) => {
  const intl = useIntl();
  const { formatMessage } = intl;
  const { schema } = useHubspotSchema();

  const t = (id: string, defaultMessage: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage });

  const datumLabel: Record<CompanyDatum, string> = {
    name: t("company.datum.name", "Legal name"),
    siret: t("company.datum.siret", "SIRET"),
    siren: t("company.datum.siren", "SIREN"),
    address: t("company.datum.address", "Address"),
    zip: t("company.datum.zip", "Postal code"),
    city: t("company.datum.city", "City"),
    headquarters: t("company.datum.headquarters", "Is headquarters"),
    naf: t("company.datum.naf", "NAF code"),
    nafLabel: t("company.datum.nafLabel", "NAF label"),
    headcount: t("company.datum.headcount", "Headcount range"),
  };

  const mapped = COMPANY_DATA.filter((d) => map[d]);
  const unmapped = COMPANY_DATA.filter((d) => !map[d]);

  const patch = (datum: CompanyDatum, entry?: { object?: string; property?: string }) => {
    const next = { ...map };
    if (entry) next[datum] = entry;
    else delete next[datum];
    onChange(next);
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {mapped.map((datum) => {
        const entry = map[datum] ?? {};
        const object = entry.object?.trim() || "company";
        const properties = (schema?.properties ?? []).filter((p) => p.object === object);
        return (
          <Box key={datum} background="neutral100" hasRadius padding={2}>
            <Flex justifyContent="space-between" alignItems="center" paddingBottom={1}>
              <Typography variant="sigma" textColor="neutral600">
                {datumLabel[datum]}
              </Typography>
              <IconButton
                label={t("company.remove-datum", "Stop sending this datum")}
                onClick={() => patch(datum, undefined)}
              >
                <Trash />
              </IconButton>
            </Flex>
            <Flex gap={2}>
              <Box width="130px" style={{ flexShrink: 0 }}>
                <SingleSelect
                  aria-label={t("panel.object", "Object")}
                  value={object}
                  onChange={(v: string | number) =>
                    // A property never survives an object switch.
                    patch(datum, { object: String(v), property: undefined })
                  }
                >
                  {(schema?.objects ?? ["contact", "company"]).map((name) => (
                    <SingleSelectOption key={name} value={name}>
                      {objectLabel(intl, name)}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              <Box flex="1">
                <Combobox
                  aria-label={t("panel.property", "Property")}
                  value={entry.property ?? ""}
                  onChange={(v: string) => patch(datum, { object, property: v || undefined })}
                  onClear={() => patch(datum, { object, property: undefined })}
                  placeholder={t("panel.property-placeholder", "Search a property…")}
                >
                  {properties.map((p) => (
                    <ComboboxOption key={p.name} value={p.name}>
                      {p.group ? `${p.group} · ` : ""}
                      {p.label} ({p.name})
                    </ComboboxOption>
                  ))}
                </Combobox>
              </Box>
            </Flex>
          </Box>
        );
      })}

      {unmapped.length > 0 && (
        <Flex gap={2} alignItems="center">
          <Plus aria-hidden width={12} height={12} />
          <Box flex="1">
            <SingleSelect
              aria-label={t("company.add-datum", "Send another datum")}
              placeholder={t("company.add-datum", "Send another datum")}
              value=""
              onChange={(v: string | number) =>
                patch(v as CompanyDatum, { object: "company", property: undefined })
              }
            >
              {unmapped.map((datum) => (
                <SingleSelectOption key={datum} value={datum}>
                  {datumLabel[datum]}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </Box>
        </Flex>
      )}
    </Flex>
  );
};

export default CompanyMapEditor;
