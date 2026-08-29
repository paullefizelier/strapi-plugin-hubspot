import * as React from "react";
import { useIntl } from "react-intl";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from "@strapi/design-system";
import { ArrowLeft, Download } from "@strapi/icons";
import { useFetchClient } from "@strapi/strapi/admin";
import { getTranslation } from "../getTranslation";
import { PLUGIN_ID } from "../pluginId";
import type { FormListRow, SubmissionRowDto } from "../builder/types";

const PAGE_SIZE = 20;

/** Compact inline preview of a submission — the modal shows the rest. */
const preview = (values: Record<string, unknown>, max = 3): string => {
  const parts = Object.entries(values ?? {})
    .slice(0, max)
    .map(([k, v]) => `${k}: ${String(v)}`);
  const more = Object.keys(values ?? {}).length - max;
  return parts.join(" · ") + (more > 0 ? ` · +${more}` : "");
};

/**
 * The submissions browser: every stored answer, filterable by form, with a
 * per-form CSV export. Reading happens here; deleting stays in the Content
 * Manager, where the type is visible on purpose.
 */
const Submissions = () => {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const form = searchParams.get("form") ?? "";

  const [forms, setForms] = React.useState<FormListRow[]>([]);
  const [rows, setRows] = React.useState<SubmissionRowDto[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<SubmissionRowDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  React.useEffect(() => {
    get<{ forms: FormListRow[] }>(`/${PLUGIN_ID}/builder/forms`)
      .then(({ data }) => setForms(data.forms))
      .catch(() => setForms([]));
  }, [get]);

  React.useEffect(() => {
    setRows(null);
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (form) query.set("form", form);
    get<{ submissions: SubmissionRowDto[]; total: number }>(
      `/${PLUGIN_ID}/builder/submissions?${query}`,
    )
      .then(({ data }) => {
        setRows(data.submissions);
        setTotal(data.total);
      })
      .catch(() => setError(t("submissions.load-error", "Could not load the submissions.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, form, page]);

  const changeForm = (slug: string) => {
    setPage(1);
    setSearchParams(slug ? { form: slug } : {});
  };

  const exportCsv = async () => {
    if (!form) return;
    setExporting(true);
    setError(null);
    try {
      const { data } = await get<{ csv: string; filename: string }>(
        `/${PLUGIN_ID}/builder/submissions/export?form=${encodeURIComponent(form)}`,
      );
      const url = URL.createObjectURL(new Blob([data.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("submissions.export-error", "Could not export the submissions."));
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Box padding={8}>
      <Flex justifyContent="space-between" alignItems="flex-end" paddingBottom={6}>
        <Box>
          <Flex gap={2} alignItems="center">
            <IconButton label={t("submissions.back", "Back to the forms")} onClick={() => navigate("..")}>
              <ArrowLeft />
            </IconButton>
            <Typography variant="alpha" tag="h1">
              {t("submissions.title", "Submissions")}
            </Typography>
          </Flex>
          <Typography variant="epsilon" textColor="neutral600" tag="p">
            {t(
              "submissions.subtitle",
              "Every answer received by the built forms — stored whatever the CRM's mood.",
            )}
          </Typography>
        </Box>
        <Flex gap={2}>
          <SingleSelect
            aria-label={t("submissions.filter", "Filter by form")}
            placeholder={t("submissions.all-forms", "All forms")}
            value={form}
            onChange={(v: string | number) => changeForm(String(v))}
            onClear={() => changeForm("")}
          >
            {forms.map((f) => (
              <SingleSelectOption key={f.slug} value={f.slug}>
                {f.name}
              </SingleSelectOption>
            ))}
          </SingleSelect>
          <Button
            variant="secondary"
            startIcon={<Download />}
            onClick={exportCsv}
            disabled={!form || exporting}
            title={form ? undefined : t("submissions.export-pick", "Pick a form to export")}
          >
            {t("submissions.export", "Export CSV")}
          </Button>
        </Flex>
      </Flex>

      {error && (
        <Box paddingBottom={4}>
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      )}

      {!rows ? (
        <Loader>{t("submissions.loading", "Loading…")}</Loader>
      ) : rows.length === 0 ? (
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={8}>
          <Typography textColor="neutral600">
            {form
              ? t("submissions.empty-form", "No submission for this form yet.")
              : t("submissions.empty", "No submission yet.")}
          </Typography>
        </Box>
      ) : (
        <>
          <Table colCount={5} rowCount={rows.length}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">{t("submissions.col-date", "Date")}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t("submissions.col-form", "Form")}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t("submissions.col-email", "Email")}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t("submissions.col-answers", "Answers")}</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">{t("submissions.col-crm", "CRM")}</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr
                  key={row.documentId}
                  onClick={() => setSelected(row)}
                  style={{ cursor: "pointer" }}
                >
                  <Td>
                    <Typography textColor="neutral600">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </Typography>
                  </Td>
                  <Td>
                    <Typography>{row.formTitle || row.form}</Typography>
                  </Td>
                  <Td>
                    <Typography fontWeight="semiBold">{row.email || "—"}</Typography>
                  </Td>
                  <Td>
                    <Typography textColor="neutral600" ellipsis>
                      {preview(row.values)}
                    </Typography>
                  </Td>
                  <Td>
                    {row.hubspotSynced ? (
                      <Badge backgroundColor="success100" textColor="success700">
                        {t("submissions.synced", "Synced")}
                      </Badge>
                    ) : (
                      <Badge backgroundColor="warning100" textColor="warning700">
                        {t("submissions.not-synced", "Not synced")}
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>

          <Flex justifyContent="space-between" paddingTop={4}>
            <Typography textColor="neutral600">
              {t("submissions.count", "{total, plural, one {# submission} other {# submissions}}", {
                total,
              })}
            </Typography>
            {pages > 1 && (
              <Flex gap={2}>
                <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t("submissions.prev", "Previous")}
                </Button>
                <Typography textColor="neutral600">
                  {t("submissions.page", "{page} / {pages}", { page, pages })}
                </Typography>
                <Button
                  variant="tertiary"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  {t("submissions.next", "Next")}
                </Button>
              </Flex>
            )}
          </Flex>
        </>
      )}

      <Modal.Root open={Boolean(selected)} onOpenChange={(open: boolean) => !open && setSelected(null)}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>
              {selected?.formTitle || selected?.form}{" "}
              {selected?.createdAt ? `— ${new Date(selected.createdAt).toLocaleString()}` : ""}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {selected && (
              <Flex direction="column" alignItems="stretch" gap={3}>
                {Object.entries(selected.values ?? {}).map(([key, value]) => (
                  <Box key={key}>
                    <Typography variant="sigma" textColor="neutral600" tag="p">
                      {key}
                    </Typography>
                    <Typography tag="p">{String(value)}</Typography>
                  </Box>
                ))}
                {selected.meta?.pagePath && (
                  <Box>
                    <Typography variant="sigma" textColor="neutral600" tag="p">
                      {t("submissions.meta-page", "Submitted from")}
                    </Typography>
                    <Typography tag="p">{selected.meta.pagePath}</Typography>
                  </Box>
                )}
              </Flex>
            )}
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </Box>
  );
};

export default Submissions;
