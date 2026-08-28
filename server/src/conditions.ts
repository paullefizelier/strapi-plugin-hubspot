/**
 * The condition engine — pure functions, no Strapi.
 */

export type Primitive = string | number | boolean;

export type Operator = "eq" | "neq" | "contains" | "empty" | "notEmpty" | "gt" | "lt";

export interface Rule {
  /** Stable id (`fld_…`) of the field the rule reads — never its name. */
  field: string;
  operator: Operator;
  value?: string;
}

export interface Condition {
  logic: "and" | "or";
  rules: Rule[];
}

export interface FormFieldDef {
  id: string;
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  visibleIf?: Condition | null;
  [key: string]: unknown;
}

export interface FormStepDef {
  id: string;
  title?: string;
  visibleIf?: Condition | null;
  fields: FormFieldDef[];
  [key: string]: unknown;
}

export interface FormDefinition {
  version: 1;
  steps: FormStepDef[];
}

export interface SubmissionResolution {
  /** Visible, non-empty values keyed by field name. */
  values: Record<string, Primitive>;
  /** Names of fields masked by a condition (their values were discarded). */
  hidden: string[];
  /** Visible required fields the submission left empty. */
  missingRequired: { id: string; name: string; label: string }[];
  /** Submitted keys the definition doesn't declare (discarded). */
  unknown: string[];
}

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** '', whitespace-only, false, null and undefined are "no answer". 0 is one. */
const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === false || (typeof v === "string" && v.trim() === "");

/** Both sides of eq/neq/contains compare as trimmed strings. */
const asString = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v);

const asNumber = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;

function evaluateRule(rule: Rule, get: (fieldId: string) => unknown): boolean {
  const value = get(rule.field);
  switch (rule.operator) {
    case "eq":
      return asString(value) === asString(rule.value);
    case "neq":
      return asString(value) !== asString(rule.value);
    case "contains":
      return asString(value).toLowerCase().includes(asString(rule.value).toLowerCase());
    case "empty":
      return isEmpty(value);
    case "notEmpty":
      return !isEmpty(value);
    case "gt": {
      const [a, b] = [asNumber(value), asNumber(rule.value)];
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case "lt": {
      const [a, b] = [asNumber(value), asNumber(rule.value)];
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    default:
      return false;
  }
}

/** An absent condition, or one with no rules, never hides anything. */
export function evaluateCondition(
  condition: Condition | null | undefined,
  get: (fieldId: string) => unknown,
): boolean {
  if (!condition || !condition.rules?.length) return true;
  const results = condition.rules.map((rule) => evaluateRule(rule, get));
  return condition.logic === "or" ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Single pass in document order. The builder only lets a rule reference an
 * earlier field, so by the time a condition is evaluated every field it can
 * read has already been resolved — and a hidden one reads as `undefined`,
 * which cascades: fields depending on it fall with it.
 */
export function resolveSubmission(
  definition: FormDefinition,
  rawValues: Record<string, unknown>,
): SubmissionResolution {
  // Value of each *visible* field so far, by id — what conditions read.
  const visibleById = new Map<string, unknown>();
  const get = (fieldId: string) => visibleById.get(fieldId);

  const values: Record<string, Primitive> = {};
  const hidden: string[] = [];
  const missingRequired: SubmissionResolution["missingRequired"] = [];
  const declared = new Set<string>();

  for (const step of definition.steps ?? []) {
    const stepVisible = evaluateCondition(step.visibleIf, get);
    for (const fld of step.fields ?? []) {
      declared.add(fld.name);
      const visible = stepVisible && evaluateCondition(fld.visibleIf, get);
      if (!visible) {
        hidden.push(fld.name);
        continue; // not registered in visibleById → reads as empty downstream
      }
      const raw = rawValues[fld.name];
      const value = typeof raw === "string" ? raw.trim() : raw;
      const submitted = isPrimitive(value) && !isEmpty(value) ? value : undefined;
      visibleById.set(fld.id, submitted);
      if (submitted !== undefined) {
        values[fld.name] = submitted;
      } else if (fld.required) {
        missingRequired.push({ id: fld.id, name: fld.name, label: fld.label ?? fld.name });
      }
    }
  }

  const unknown = Object.keys(rawValues).filter((key) => !declared.has(key));
  return { values, hidden, missingRequired, unknown };
}
