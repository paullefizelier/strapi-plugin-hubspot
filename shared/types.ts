/**
 * Public types of strapi-plugin-hubspot, for host apps and frontends:
 *
 *   import type { PublicForm, Condition } from "strapi-plugin-hubspot/types";
 *
 * They describe the payloads of the public content-api routes:
 *   GET  /api/hubspot/forms/:slug         → PublicForm
 *   POST /api/hubspot/forms/:slug/submit  → SubmitResponse (SubmitRequest in)
 */

export type Operator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty"
  | "gt"
  | "lt"
  | "in"
  | "notIn";

export interface Rule {
  /** Stable id (`fld_…`) of the field the rule reads — never its name. */
  field: string;
  operator: Operator;
  value?: string;
  /** For `in` / `notIn`: the values any one of which satisfies the rule. */
  values?: string[];
}

export interface Condition {
  logic: "and" | "or";
  rules: Rule[];
}

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "website"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio";

export interface FieldOption {
  value: string;
  label?: string;
}

/** A field as the public endpoint serves it — the CRM mapping is stripped. */
export interface PublicFormField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  helpText?: string;
  icon?: string;
  class?: string;
  width?: "full" | "half";
  required?: boolean;
  persist?: "session" | "days30";
  options?: FieldOption[];
  visibleIf?: Condition | null;
}

export interface PublicFormStep {
  id: string;
  title?: string;
  description?: string;
  class?: string;
  visibleIf?: Condition | null;
  fields: PublicFormField[];
}

/** GET /api/hubspot/forms/:slug */
export interface PublicForm {
  slug: string;
  title?: string | null;
  subtitle?: string | null;
  nextLabel?: string | null;
  submitLabel?: string | null;
  successMessage?: string | null;
  /** Extra utility classes on the form wrapper, for the host frontend. */
  class?: string | null;
  locale?: string | null;
  steps: PublicFormStep[];
}

/** POST /api/hubspot/forms/:slug/submit — request body. */
export interface SubmitRequest {
  /** Answers keyed by field `name`. Values hidden by a condition are ignored. */
  values: Record<string, string | number | boolean>;
  meta?: {
    pagePath?: string;
    pageUrl?: string;
    originPath?: string;
    originLabel?: string;
    source?: string;
  };
}

/** POST /api/hubspot/forms/:slug/submit — 200 response. */
export interface SubmitResponse {
  ok: true;
  /** False when the CRM was unreachable — the submission is stored either way. */
  hubspotSynced: boolean;
}

/** POST /api/hubspot/forms/:slug/submit — 422 response. */
export interface SubmitValidationError {
  ok: false;
  missingRequired: { id: string; name: string; label: string }[];
}
