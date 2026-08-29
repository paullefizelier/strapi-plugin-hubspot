/** Client-side mirror of the server's definition types (server/src/conditions.ts). */

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

export const FIELD_TYPES: FieldType[] = [
  "text",
  "email",
  "tel",
  "number",
  "website",
  "textarea",
  "select",
  "checkbox",
  "radio",
];

export interface FieldOption {
  value: string;
  label?: string;
}

export interface FormField {
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
  hubspot?: { object?: string; property?: string };
  visibleIf?: Condition | null;
}

export interface FormStep {
  id: string;
  title?: string;
  description?: string;
  class?: string;
  visibleIf?: Condition | null;
  fields: FormField[];
}

export interface FormDefinition {
  version: 1;
  steps: FormStep[];
}

export interface FormEntryDto {
  documentId: string;
  name: string;
  slug: string;
  title?: string | null;
  subtitle?: string | null;
  nextLabel?: string | null;
  submitLabel?: string | null;
  successMessage?: string | null;
  class?: string | null;
  locale?: string | null;
  updatedAt?: string;
  definition: FormDefinition;
}

export interface FormListRow {
  documentId: string;
  name: string;
  slug: string;
  updatedAt: string;
  published: boolean;
  steps: number;
  fields: number;
  submissions: number;
}

/** One form of the connected portal, offered for import. */
export interface HubspotSource {
  id: string;
  name: string;
  updatedAt?: string;
}

/** What a HubSpot import couldn't carry over (mirrors server SkippedItem). */
export interface SkippedItem {
  code:
    | "field-type"
    | "hidden-field"
    | "object"
    | "duplicate"
    | "condition"
    | "rich-text"
    | "legal-consent";
  label?: string;
  detail?: string;
}

/** One stored submission, as the admin list serves it. */
export interface SubmissionRowDto {
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

export interface DefinitionError {
  code: "duplicate-name" | "missing-name" | "unknown-field" | "forward-reference" | "missing-value";
  fieldId?: string;
  stepId?: string;
  name?: string;
  target?: string;
}

export interface MappingProblem {
  code: "unknown" | "wrong-object" | "whitespace" | "bad-option";
  fieldId: string;
  property: string;
  object: string;
  actualObject?: string;
}

let counter = 0;

/** Stable, unique-enough ids for steps and fields (never shown to anyone). */
export const makeId = (prefix: "stp" | "fld"): string =>
  `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

/** Every field that comes before `beforeId` (a field or step id) in form order. */
export function fieldsBefore(definition: FormDefinition, beforeId: string): FormField[] {
  const out: FormField[] = [];
  for (const step of definition.steps) {
    if (step.id === beforeId) return out;
    for (const field of step.fields) {
      if (field.id === beforeId) return out;
      out.push(field);
    }
  }
  return out;
}

/** Field lookup across steps. */
export function findField(definition: FormDefinition, fieldId: string): FormField | undefined {
  for (const step of definition.steps) {
    const found = step.fields.find((f) => f.id === fieldId);
    if (found) return found;
  }
  return undefined;
}
