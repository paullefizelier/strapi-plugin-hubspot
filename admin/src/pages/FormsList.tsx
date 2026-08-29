import * as React from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  TextInput,
  Th,
  Thead,
  Tr,
  Typography,
} from "@strapi/design-system";
import { Duplicate, List, Plus, Trash } from "@strapi/icons";
import { useFetchClient } from "@strapi/strapi/admin";
import { getTranslation } from "../getTranslation";
import { PLUGIN_ID } from "../pluginId";
import type { FormListRow, HubspotSource, SkippedItem } from "../builder/types";

/**
 * The forms list: every form built with the plugin, its publication state,
 * and the door to the builder. Creating a form only asks for a name — slug
 * and everything else happen in the editor.
 */
const FormsList = () => {
  const { formatMessage } = useIntl();
  const { get, post, del } = useFetchClient();
  const navigate = useNavigate();
  const [rows, setRows] = React.useState<FormListRow[] | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sources, setSources] = React.useState<{ documentId: string; name: string; slug: string }[]>([]);
  const [sourceId, setSourceId] = React.useState("");
  const [hsForms, setHsForms] = React.useState<HubspotSource[]>([]);
  const [hsFormId, setHsFormId] = React.useState("");
  const [hsError, setHsError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<{ documentId: string; skipped: SkippedItem[] } | null>(
    null,
  );

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const load = React.useCallback(async () => {
    const { data } = await get<{ forms: FormListRow[] }>(`/${PLUGIN_ID}/builder/forms`);
    setRows(data.forms);
  }, [get]);

  React.useEffect(() => {
    load().catch(() => setError(t("forms.load-error", "Could not load the forms.")));
    get<{ sources: { documentId: string; name: string; slug: string }[] }>(
      `/${PLUGIN_ID}/builder/import/sources`,
    )
      .then(({ data }) => setSources(data.sources ?? []))
      .catch(() => setSources([]));
    get<{ configured: boolean; forms: HubspotSource[] }>(`/${PLUGIN_ID}/builder/import/hubspot`)
      .then(({ data }) => setHsForms(data.configured ? (data.forms ?? []) : []))
      .catch(() =>
        // Reachable settings but no portal list: almost always the missing scope.
        setHsError(
          t(
            "forms.hubspot-list-error",
            "Could not list the portal's forms — the token needs the `forms` read scope.",
          ),
        ),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const runImport = async () => {
    if (!sourceId) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await post<{ documentId: string }>(`/${PLUGIN_ID}/builder/import`, {
        documentId: sourceId,
      });
      navigate(data.documentId);
    } catch {
      setError(t("forms.import-error", "Could not import the form."));
      setBusy(false);
    }
  };

  const runHubspotImport = async () => {
    if (!hsFormId) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const { data } = await post<{ documentId: string; skipped: SkippedItem[] }>(
        `/${PLUGIN_ID}/builder/import/hubspot`,
        { formId: hsFormId },
      );
      if (data.skipped.length) {
        // Something was left behind: show the report before the editor opens,
        // so the losses are read while the HubSpot original is still in mind.
        setReport(data);
        setBusy(false);
        await load();
      } else {
        navigate(data.documentId);
      }
    } catch {
      setError(t("forms.import-error", "Could not import the form."));
      setBusy(false);
    }
  };

  /** One readable line per skipped item — codes stay technical, lines don't. */
  const skippedLine = (item: SkippedItem): string => {
    const label = item.label ?? "";
    const detail = item.detail ?? "";
    switch (item.code) {
      case "field-type":
        return t("forms.skipped-field-type", '"{label}" skipped — unsupported type ({detail})', { label, detail });
      case "hidden-field":
        return t("forms.skipped-hidden", '"{label}" skipped — hidden fields are not supported yet', { label });
      case "object":
        return t("forms.skipped-object", '"{label}" skipped — unmapped object ({detail})', { label, detail });
      case "duplicate":
        return t("forms.skipped-duplicate", '"{label}" skipped — the name "{detail}" is already used', { label, detail });
      case "condition":
        return t("forms.skipped-condition", 'Condition on "{label}" dropped — no equivalent operator ({detail})', { label, detail });
      case "rich-text":
        return t("forms.skipped-rich-text", "A content block was skipped — the builder has no rich-text element");
      case "legal-consent":
        return t("forms.skipped-consent", "The GDPR consent block was skipped — rebuild it as a field if needed");
    }
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await post<{ form: { documentId: string } }>(
        `/${PLUGIN_ID}/builder/forms`,
        { name: name.trim() },
      );
      navigate(data.form.documentId);
    } catch {
      setError(t("forms.create-error", "Could not create the form."));
      setBusy(false);
    }
  };

  const duplicate = async (row: FormListRow) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await post<{ documentId: string }>(
        `/${PLUGIN_ID}/builder/forms/${row.documentId}/duplicate`,
      );
      navigate(data.documentId);
    } catch {
      setError(t("forms.duplicate-error", "Could not duplicate the form."));
      setBusy(false);
    }
  };

  const remove = async (row: FormListRow) => {
    if (!window.confirm(t("forms.delete-confirm", 'Delete "{name}" and all its locales?', { name: row.name }))) {
      return;
    }
    setBusy(true);
    try {
      await del(`/${PLUGIN_ID}/builder/forms/${row.documentId}`);
      await load();
    } catch {
      setError(t("forms.delete-error", "Could not delete the form."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box padding={8}>
      <Flex justifyContent="space-between" alignItems="flex-end" paddingBottom={6}>
        <Box>
          <Typography variant="alpha" tag="h1">
            {t("forms.title", "HubSpot forms")}
          </Typography>
          <Typography variant="epsilon" textColor="neutral600" tag="p">
            {t(
              "forms.subtitle",
              "Multi-step forms with conditional fields, mapped to your portal's real properties.",
            )}
          </Typography>
        </Box>
        <Flex gap={2}>
          <Button variant="tertiary" startIcon={<List />} onClick={() => navigate("submissions")}>
            {t("forms.submissions", "Submissions")}
          </Button>
          <TextInput
            aria-label={t("forms.name-label", "Name of the new form")}
            placeholder={t("forms.name-placeholder", "Name of the new form")}
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && create()}
          />
          <Button startIcon={<Plus />} onClick={create} disabled={busy || !name.trim()}>
            {t("forms.create", "Create")}
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Box paddingBottom={4}>
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      )}

      {(sources.length > 0 || hsForms.length > 0 || hsError) && (
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
          <Flex direction="column" alignItems="stretch" gap={3}>
            {hsForms.length > 0 && (
              <Flex gap={2} alignItems="flex-end" justifyContent="space-between">
                <Box>
                  <Typography variant="delta" tag="h2">
                    {t("forms.import-hubspot-title", "Import from your HubSpot portal")}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {t(
                      "forms.import-hubspot-hint",
                      "Translates a form built in HubSpot into a draft here, CRM mapping included. What the builder can't express is skipped and reported. Re-importing overwrites the draft.",
                    )}
                  </Typography>
                </Box>
                <Flex gap={2}>
                  <SingleSelect
                    aria-label={t("forms.import-hubspot-source", "HubSpot form to import")}
                    placeholder={t("forms.import-hubspot-source", "HubSpot form to import")}
                    value={hsFormId}
                    onChange={(v: string | number) => setHsFormId(String(v))}
                  >
                    {hsForms.map((f) => (
                      <SingleSelectOption key={f.id} value={f.id}>
                        {f.name}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Button variant="secondary" onClick={runHubspotImport} disabled={busy || !hsFormId}>
                    {t("forms.import", "Import")}
                  </Button>
                </Flex>
              </Flex>
            )}
            {hsError && (
              <Typography variant="pi" textColor="warning700">
                {hsError}
              </Typography>
            )}
            {sources.length > 0 && (
              <Flex gap={2} alignItems="flex-end" justifyContent="space-between">
                <Box>
                  <Typography variant="delta" tag="h2">
                    {t("forms.import-title", "Import an existing form")}
                  </Typography>
                  <Typography variant="pi" textColor="neutral600" tag="p">
                    {t(
                      "forms.import-hint",
                      "Converts a legacy content-type form (all locales) into a draft here — same slug, source untouched. Re-importing overwrites the draft.",
                    )}
                  </Typography>
                </Box>
                <Flex gap={2}>
                  <SingleSelect
                    aria-label={t("forms.import-source", "Form to import")}
                    placeholder={t("forms.import-source", "Form to import")}
                    value={sourceId}
                    onChange={(v: string | number) => setSourceId(String(v))}
                  >
                    {sources.map((s) => (
                      <SingleSelectOption key={s.documentId} value={s.documentId}>
                        {s.name} {s.slug ? `(${s.slug})` : ""}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                  <Button variant="secondary" onClick={runImport} disabled={busy || !sourceId}>
                    {t("forms.import", "Import")}
                  </Button>
                </Flex>
              </Flex>
            )}
          </Flex>
        </Box>
      )}

      {report && (
        <Box background="warning100" hasRadius padding={4} marginBottom={4}>
          <Flex justifyContent="space-between" alignItems="flex-start" gap={4}>
            <Box>
              <Typography variant="delta" tag="h2" textColor="warning700">
                {t("forms.report-title", "Imported with gaps")}
              </Typography>
              <Box tag="ul" paddingTop={2} style={{ listStyle: "disc", paddingLeft: 16 }}>
                {report.skipped.map((item, i) => (
                  <li key={i}>
                    <Typography variant="pi" textColor="warning700">
                      {skippedLine(item)}
                    </Typography>
                  </li>
                ))}
              </Box>
            </Box>
            <Flex gap={2} shrink={0}>
              <Button variant="tertiary" onClick={() => setReport(null)}>
                {t("forms.report-dismiss", "Dismiss")}
              </Button>
              <Button onClick={() => navigate(report.documentId)}>
                {t("forms.report-open", "Open the form")}
              </Button>
            </Flex>
          </Flex>
        </Box>
      )}

      {!rows ? (
        <Loader>{t("forms.loading", "Loading…")}</Loader>
      ) : rows.length === 0 ? (
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={8}>
          <Typography textColor="neutral600">
            {t("forms.empty", "No form yet — name one above to open the builder.")}
          </Typography>
        </Box>
      ) : (
        <Table colCount={7} rowCount={rows.length}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">{t("forms.col-name", "Name")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-slug", "Slug")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-structure", "Structure")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-status", "Status")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-submissions", "Submissions")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-updated", "Updated")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-actions", "Actions")}</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr
                key={row.documentId}
                onClick={() => navigate(row.documentId)}
                style={{ cursor: "pointer" }}
              >
                <Td>
                  <Typography fontWeight="semiBold">{row.name}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral600">{row.slug}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral600">
                    {t("forms.structure", "{steps, plural, one {# step} other {# steps}} · {fields, plural, one {# field} other {# fields}}", {
                      steps: row.steps,
                      fields: row.fields,
                    })}
                  </Typography>
                </Td>
                <Td>
                  {row.published ? (
                    <Badge backgroundColor="success100" textColor="success700">
                      {t("forms.published", "Published")}
                    </Badge>
                  ) : (
                    <Badge backgroundColor="secondary100" textColor="secondary700">
                      {t("forms.draft", "Draft")}
                    </Badge>
                  )}
                </Td>
                <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                  {row.submissions > 0 ? (
                    <Button
                      variant="ghost"
                      startIcon={<List />}
                      onClick={() => navigate(`submissions?form=${encodeURIComponent(row.slug)}`)}
                    >
                      {row.submissions}
                    </Button>
                  ) : (
                    <Typography textColor="neutral600">—</Typography>
                  )}
                </Td>
                <Td>
                  <Typography textColor="neutral600">
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                  </Typography>
                </Td>
                <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                  <Flex gap={1}>
                    <IconButton
                      label={t("forms.duplicate", "Duplicate")}
                      onClick={() => duplicate(row)}
                      disabled={busy}
                    >
                      <Duplicate />
                    </IconButton>
                    <IconButton
                      label={t("forms.delete", "Delete")}
                      onClick={() => remove(row)}
                      disabled={busy}
                    >
                      <Trash />
                    </IconButton>
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Box>
  );
};

export default FormsList;
