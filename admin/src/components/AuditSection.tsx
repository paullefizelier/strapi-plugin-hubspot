import * as React from "react";
import { useIntl } from "react-intl";
import { Link as RouterLink } from "react-router-dom";
import { Badge, Box, Button, Divider, Flex, Link, Typography } from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { PLUGIN_ID } from "../pluginId";
import { getTranslation } from "../getTranslation";
import { objectLabel } from "../objectLabels";

/**
 * On-demand audit of every validated content type.
 *
 * Save-time validation only protects entries as they are written; a property
 * deleted in HubSpot afterwards leaves invalid mappings dormant. This walks
 * all entries server-side and lists the ones the portal would reject today,
 * each linking to its edit view in the Content Manager.
 */

type Problem =
  | { code: "unknown"; property: string; object: string }
  | { code: "wrong-object"; property: string; object: string; actualObject: string }
  | { code: "whitespace"; property: string; object: string }
  | { code: "bad-option"; property: string; object: string; values: string[] };

interface AuditEntry {
  documentId: string;
  locale?: string;
  label: string;
  problems: Problem[];
}

interface AuditTargetReport {
  uid: string;
  entries: number;
  mappings: number;
  invalid: AuditEntry[];
  error?: string;
}

interface AuditResponse {
  configured: boolean;
  targets: AuditTargetReport[];
}

const AuditSection = ({ configured }: { configured: boolean }) => {
  const intl = useIntl();
  const { formatMessage } = intl;
  const { get } = useFetchClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [result, setResult] = React.useState<AuditResponse | null>(null);

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const problemText = (p: Problem): string => {
    switch (p.code) {
      case "unknown":
        return t("problem.unknown", "“{property}” does not exist on {object} in this portal", {
          property: p.property,
          object: objectLabel(intl, p.object),
        });
      case "wrong-object":
        return t("problem.wrong-object", "“{property}” exists on {actual}, not on {object}", {
          property: p.property,
          object: objectLabel(intl, p.object),
          actual: objectLabel(intl, p.actualObject),
        });
      case "whitespace":
        return t("problem.whitespace", "“{property}” has surrounding whitespace", {
          property: p.property,
        });
      case "bad-option":
        return t("problem.bad-option", "“{property}” does not accept {values}", {
          property: p.property,
          values: p.values.join(", "),
        });
    }
  };

  const run = async () => {
    setBusy(true);
    setError(false);
    setResult(null);
    try {
      const { data } = await get<AuditResponse>(`/${PLUGIN_ID}/audit`);
      setResult(data);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const entryLink = (uid: string, entry: AuditEntry) =>
    `/content-manager/collection-types/${uid}/${entry.documentId}` +
    (entry.locale ? `?plugins[i18n][locale]=${entry.locale}` : "");

  const totalInvalid = result?.targets.reduce((n, r) => n + r.invalid.length, 0) ?? 0;

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Divider />

      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography variant="beta">{t("audit.title", "Mapping audit")}</Typography>
        <Typography variant="epsilon" textColor="neutral600">
          {t(
            "audit.subtitle",
            "Scans every entry of the validated content types and lists the mappings the portal would reject today — including properties deleted in HubSpot since they were saved.",
          )}
        </Typography>
      </Flex>

      <Flex gap={2}>
        <Button variant="secondary" onClick={run} loading={busy} disabled={!configured}>
          {t("audit.run", "Run the audit")}
        </Button>
      </Flex>

      {error ? (
        <Typography variant="pi" textColor="danger600">
          {t("audit.error", "Audit failed — HubSpot unreachable?")}
        </Typography>
      ) : null}

      {result && !result.targets.length ? (
        <Typography variant="pi" textColor="neutral600">
          {t(
            "audit.no-targets",
            "No content type to audit — declare them under `validate` in the plugin config.",
          )}
        </Typography>
      ) : null}

      {result && result.targets.length ? (
        <Flex direction="column" alignItems="stretch" gap={4}>
          {totalInvalid === 0 && result.targets.every((r) => !r.error) ? (
            <Typography variant="pi" textColor="success600">
              {t("audit.clean", "Nothing to report — every mapping is valid.")}
            </Typography>
          ) : null}

          {result.targets.map((report) => (
            <Box key={report.uid}>
              <Flex gap={2} alignItems="center" paddingBottom={2}>
                <Typography variant="delta">{report.uid}</Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t("audit.summary", "{entries} entries · {mappings} mappings", {
                    entries: report.entries,
                    mappings: report.mappings,
                  })}
                </Typography>
              </Flex>

              {report.error ? (
                <Typography variant="pi" textColor="danger600">
                  {t("audit.target-error", "Could not scan: {error}", { error: report.error })}
                </Typography>
              ) : null}

              <Flex direction="column" alignItems="stretch" gap={2}>
                {report.invalid.map((entry) => (
                  <Box
                    key={`${entry.documentId}-${entry.locale ?? ""}`}
                    padding={3}
                    background="neutral100"
                    hasRadius
                  >
                    <Flex gap={2} alignItems="center">
                      <Link tag={RouterLink} to={entryLink(report.uid, entry)}>
                        {entry.label}
                      </Link>
                      {entry.locale ? <Badge>{entry.locale}</Badge> : null}
                    </Flex>
                    <Box paddingTop={1}>
                      {entry.problems.map((p, i) => (
                        <Typography key={i} variant="pi" textColor="danger600" tag="p">
                          {problemText(p)}
                        </Typography>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Flex>
            </Box>
          ))}
        </Flex>
      ) : null}
    </Flex>
  );
};

export default AuditSection;
