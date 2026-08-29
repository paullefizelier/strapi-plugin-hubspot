/**
 * Reading side of the submissions store — the admin's Submissions tab and its
 * CSV export. Pure shaping here; the controller does the fetching.
 *
 * The CSV columns follow the *form definition* order (the way the editor
 * reads the form), then any extra keys found in older submissions — a field
 * renamed or removed since doesn't lose its historical answers.
 */

import type { FormDefinition } from "./conditions";

export interface SubmissionRow {
  documentId: string;
  form: string;
  formTitle?: string | null;
  email?: string | null;
  values: Record<string, string | number | boolean>;
  meta?: Record<string, string> | null;
  locale?: string | null;
  hubspotSynced?: boolean;
  createdAt?: string;
}

/** Field names in definition order — the natural reading order of the form. */
export function fieldOrder(definition: FormDefinition | null | undefined): string[] {
  if (!definition) return [];
  return definition.steps.flatMap((step) => step.fields.map((field) => field.name));
}

/** RFC 4180 quoting: only when the value needs it, doubling inner quotes. */
const escapeCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Submissions → CSV. `knownFields` (usually `fieldOrder(definition)`) leads;
 * keys present in the rows but not in the definition are appended, sorted, so
 * nothing recorded is ever silently dropped from an export.
 */
export function submissionsCsv(rows: SubmissionRow[], knownFields: string[]): string {
  const extra = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.values ?? {})) {
      if (!knownFields.includes(key)) extra.add(key);
    }
  }
  const valueColumns = [...knownFields, ...[...extra].sort()];

  const header = [
    "submittedAt",
    ...valueColumns,
    "hubspotSynced",
    "locale",
    "pagePath",
    "source",
  ];

  const lines = [header.map(escapeCell).join(",")];
  for (const row of rows) {
    const cells = [
      row.createdAt ?? "",
      ...valueColumns.map((key) => row.values?.[key]),
      row.hubspotSynced ? "true" : "false",
      row.locale ?? "",
      row.meta?.pagePath ?? "",
      row.meta?.source ?? "",
    ];
    lines.push(cells.map(escapeCell).join(","));
  }
  return lines.join("\r\n");
}
