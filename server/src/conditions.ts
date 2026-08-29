/**
 * The condition engine — pure functions, no Strapi.
 */

export type Primitive = string | number | boolean;

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

export type DefinitionError =
  | { code: "duplicate-name"; fieldId: string; name: string }
  | { code: "missing-name"; fieldId: string; name: string }
  | { code: "companion-collision"; fieldId: string; name: string }
  | { code: "unknown-field"; fieldId?: string; stepId?: string; target: string }
  | { code: "forward-reference"; fieldId?: string; stepId?: string; target: string }
  | { code: "missing-value"; fieldId?: string; stepId?: string; target: string };

/** Operators that compare against a value — the others just probe presence. */
const NEEDS_VALUE: ReadonlySet<Operator> = new Set([
  "eq",
  "neq",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "gt",
  "lt",
]);
/** Operators that compare against a LIST of values. */
const NEEDS_VALUES: ReadonlySet<Operator> = new Set(["in", "notIn"]);

/**
 * Structural check of a definition — what the builder enforces, re-checked
 * server-side so a hand-crafted PUT can't save a form the engine can't run:
 * unique non-empty names, and conditions that only look back.
 */
export function validateDefinition(definition: FormDefinition): DefinitionError[] {
  const errors: DefinitionError[] = [];
  const allIds = new Set<string>();
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) allIds.add(fld.id);
  }

  const checkCondition = (
    condition: Condition | null | undefined,
    seen: Set<string>,
    owner: { fieldId?: string; stepId?: string },
  ) => {
    for (const rule of condition?.rules ?? []) {
      if (!allIds.has(rule.field)) {
        errors.push({ code: "unknown-field", ...owner, target: rule.field });
      } else if (!seen.has(rule.field)) {
        errors.push({ code: "forward-reference", ...owner, target: rule.field });
      }
      if (NEEDS_VALUE.has(rule.operator) && (rule.value === undefined || rule.value === "")) {
        errors.push({ code: "missing-value", ...owner, target: rule.field });
      }
      if (NEEDS_VALUES.has(rule.operator) && !rule.values?.length) {
        errors.push({ code: "missing-value", ...owner, target: rule.field });
      }
    }
  };

  // Company fields own the flat companion keys `<name>__siret` and
  // `<name>__company` in the submission payload — no field may claim them.
  const reservedNames = new Set<string>();
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      if (fld.type === "company" && fld.name?.trim()) {
        reservedNames.add(`${fld.name}__siret`);
        reservedNames.add(`${fld.name}__company`);
      }
    }
  }

  const seen = new Set<string>();
  const seenNames = new Set<string>();
  for (const step of definition.steps ?? []) {
    checkCondition(step.visibleIf, seen, { stepId: step.id });
    for (const fld of step.fields ?? []) {
      if (!fld.name?.trim()) {
        errors.push({ code: "missing-name", fieldId: fld.id, name: fld.name ?? "" });
      } else if (seenNames.has(fld.name)) {
        errors.push({ code: "duplicate-name", fieldId: fld.id, name: fld.name });
      } else if (reservedNames.has(fld.name)) {
        errors.push({ code: "companion-collision", fieldId: fld.id, name: fld.name });
      } else {
        seenNames.add(fld.name);
      }
      checkCondition(fld.visibleIf, seen, { fieldId: fld.id });
      seen.add(fld.id);
    }
  }
  return errors;
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
    case "notContains":
      return !asString(value).toLowerCase().includes(asString(rule.value).toLowerCase());
    case "startsWith":
      return asString(value).toLowerCase().startsWith(asString(rule.value).toLowerCase());
    case "endsWith":
      return asString(value).toLowerCase().endsWith(asString(rule.value).toLowerCase());
    case "in":
      return (rule.values ?? []).some((v) => asString(v) === asString(value));
    case "notIn":
      return !(rule.values ?? []).some((v) => asString(v) === asString(value));
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
