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
import { Plus, Trash } from "@strapi/icons";
import { useFetchClient } from "@strapi/strapi/admin";
import { getTranslation } from "../getTranslation";
import { PLUGIN_ID } from "../pluginId";
import type { FormListRow } from "../builder/types";

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

  const remove = async (row: FormListRow) => {
    // eslint-disable-next-line no-alert
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

      {sources.length > 0 && (
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} marginBottom={4}>
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
        <Table colCount={6} rowCount={rows.length}>
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
                <Typography variant="sigma">{t("forms.col-updated", "Updated")}</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">{t("forms.col-actions", "")}</Typography>
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
                    {t("forms.structure", "{steps} steps · {fields} fields", {
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
                <Td>
                  <Typography textColor="neutral600">
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                  </Typography>
                </Td>
                <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                  <IconButton
                    label={t("forms.delete", "Delete")}
                    onClick={() => remove(row)}
                    disabled={busy}
                  >
                    <Trash />
                  </IconButton>
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
