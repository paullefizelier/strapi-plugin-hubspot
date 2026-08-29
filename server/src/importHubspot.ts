/**
 * Conversion of a HubSpot-hosted form (marketing v3 Forms API) into the
 * plugin's definition model — the second import path of the builder, next to
 * the legacy content-type one (importLegacy.ts).
 *
 * The translation is deliberately lossy-but-honest: everything the builder
 * can express is carried over (fields, options, required, two-per-row
 * layouts, dependent-field conditions), and everything it can't is *skipped
 * and reported* rather than half-imported — the caller shows the report so
 * the editor knows exactly what to rebuild by hand.
 *
 * A HubSpot form field IS a CRM property (`name` + `objectTypeId`), so an
 * imported form arrives with a mapping that is already valid for the portal.
 */

import type { Condition, FormDefinition, FormFieldDef, Operator } from "./conditions";

const HS_BASE = "https://api.hubapi.com";

/** One row of the portal's form list, as offered for import. */
export interface HubspotFormSummary {
  id: string;
  name: string;
  updatedAt?: string;
}

/** Something the converter could not express in the builder's model. */
export interface SkippedItem {
  code:
    | "field-type" // fieldType the builder has no equivalent for (file, date…)
    | "hidden-field" // hidden/pre-filled fields don't exist yet
    | "object" // property of an object the plugin doesn't map (tickets…)
    | "duplicate" // second occurrence of a property name (names must be unique)
    | "condition" // dependent-field logic the condition engine can't express
    | "rich-text" // content blocks between fields
    | "legal-consent"; // GDPR consent block — must be rebuilt as a field
  /** Field label or name, when the item is a field. */
  label?: string;
  /** Raw detail (the fieldType, the operator…) for the report. */
  detail?: string;
}

export interface ConvertedHubspotForm {
  name: string;
  submitLabel?: string | null;
  successMessage?: string | null;
  definition: FormDefinition;
  skipped: SkippedItem[];
}

/* ------------------------------------------------------------------ */
/* Raw API shapes — only the parts read here, everything optional.    */
/* ------------------------------------------------------------------ */

interface RawDependent {
  dependentCondition?: { operator?: string; values?: unknown[] };
  field?: RawField;
}

interface RawField {
  objectTypeId?: string;
  name?: string;
  label?: string;
  fieldType?: string;
  required?: boolean;
  hidden?: boolean;
  placeholder?: string;
  description?: string;
  options?: { value?: unknown; label?: string }[];
  dependentFields?: RawDependent[];
}

interface RawFieldGroup {
  richText?: string;
  fields?: RawField[];
}

export interface RawHubspotForm {
  id?: string;
  name?: string;
  fieldGroups?: RawFieldGroup[];
  displayOptions?: { submitButtonText?: string };
  configuration?: { postSubmitAction?: { type?: string; value?: string } };
  legalConsentOptions?: { type?: string } | null;
}

/* ------------------------------------------------------------------ */
/* Conversion                                                          */
/* ------------------------------------------------------------------ */

/** HubSpot's object type ids for the two objects the plugin maps by default. */
const OBJECT_BY_TYPE_ID: Record<string, string> = {
  "0-1": "contact",
  "0-2": "company",
};

/** fieldType → builder type; anything absent here is skipped and reported. */
const TYPE_MAP: Record<string, string> = {
  single_line_text: "text",
  multi_line_text: "textarea",
  email: "email",
  phone: "tel",
  mobile_phone: "tel",
  number: "number",
  dropdown: "select",
  select: "select",
  radio: "radio",
  multiple_checkboxes: "checkbox",
  single_checkbox: "checkbox",
  booleancheckbox: "checkbox",
};

let counter = 0;
const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/**
 * Dependent-field logic → a `visibleIf`. HubSpot compares one parent field
 * against a value list; the engine compares against single values — so a
 * list becomes one rule per value, OR'd (AND'd for the negative operators).
 * An operator with no equivalent returns null: the field is imported
 * *without* its condition (always visible), which the caller reports.
 */
function convertCondition(
  parentFieldId: string,
  raw: NonNullable<RawDependent["dependentCondition"]>,
): Condition | null {
  const operator = (raw.operator ?? "").toUpperCase();
  const values = (raw.values ?? []).map((v) => String(v)).filter((v) => v !== "");

  const spread = (op: Operator, logic: "and" | "or"): Condition | null =>
    values.length
      ? { logic, rules: values.map((value) => ({ field: parentFieldId, operator: op, value })) }
      : null;

  switch (operator) {
    case "EQ":
    case "SET_ANY":
      return spread("eq", "or");
    case "NEQ":
    case "NOT_SET_ANY":
      return spread("neq", "and");
    case "CONTAINS":
      return spread("contains", "or");
    case "GT":
      return spread("gt", "or");
    case "LT":
      return spread("lt", "or");
    case "SET":
    case "NOT_EMPTY":
      return { logic: "and", rules: [{ field: parentFieldId, operator: "notEmpty" }] };
    case "NOT_SET":
    case "EMPTY":
      return { logic: "and", rules: [{ field: parentFieldId, operator: "empty" }] };
    default:
      return null;
  }
}

/**
 * One raw field (and, recursively, its dependent children) → builder fields.
 * Children land right after their parent, so the engine's "conditions only
 * look back" rule holds by construction.
 */
function convertField(
  raw: RawField,
  ctx: {
    usedNames: Set<string>;
    skipped: SkippedItem[];
    parentCondition?: FormFieldDef["visibleIf"];
  },
): FormFieldDef[] {
  const label = raw.label || raw.name || "";
  const name = raw.name ?? "";

  if (raw.hidden) {
    ctx.skipped.push({ code: "hidden-field", label });
    return [];
  }
  const object = OBJECT_BY_TYPE_ID[raw.objectTypeId ?? "0-1"];
  if (!object) {
    ctx.skipped.push({ code: "object", label, detail: raw.objectTypeId });
    return [];
  }
  const type = TYPE_MAP[raw.fieldType ?? ""];
  if (!type || !name) {
    ctx.skipped.push({ code: "field-type", label, detail: raw.fieldType });
    return [];
  }
  if (ctx.usedNames.has(name)) {
    ctx.skipped.push({ code: "duplicate", label, detail: name });
    return [];
  }
  ctx.usedNames.add(name);

  const options = (raw.options ?? [])
    .map((o) => ({ value: String(o.value ?? ""), label: o.label || undefined }))
    .filter((o) => o.value !== "");

  const field: FormFieldDef = {
    id: makeId("fld"),
    name,
    label,
    type,
    required: Boolean(raw.required),
    placeholder: raw.placeholder || undefined,
    helpText: raw.description || undefined,
    ...(options.length ? { options } : {}),
    hubspot: { object, property: name },
    ...(ctx.parentCondition ? { visibleIf: ctx.parentCondition } : {}),
  };

  const out = [field];
  for (const dependent of raw.dependentFields ?? []) {
    if (!dependent.field) continue;
    const childLabel = dependent.field.label || dependent.field.name || "";
    const condition = dependent.dependentCondition
      ? convertCondition(field.id, dependent.dependentCondition)
      : null;
    if (!condition) {
      ctx.skipped.push({
        code: "condition",
        label: childLabel,
        detail: dependent.dependentCondition?.operator,
      });
    }
    // A child of a conditional parent inherits nothing extra: when the parent
    // is hidden it reads as empty, so the child's own rules already fail.
    out.push(...convertField(dependent.field, { ...ctx, parentCondition: condition }));
  }
  return out;
}

export function convertHubspotForm(raw: RawHubspotForm): ConvertedHubspotForm {
  const skipped: SkippedItem[] = [];
  const usedNames = new Set<string>();
  const fields: FormFieldDef[] = [];

  for (const group of raw.fieldGroups ?? []) {
    if (group.richText && !(group.fields ?? []).length) {
      // Standalone content block — the builder has no rich-text element.
      skipped.push({ code: "rich-text", detail: group.richText.slice(0, 80) });
      continue;
    }
    const groupFields = (group.fields ?? []).flatMap((f) =>
      convertField(f, { usedNames, skipped }),
    );
    // A HubSpot group is a row: exactly two fields side by side become two
    // half-width fields. (Dependent children don't count — they show later.)
    const topLevel = (group.fields ?? []).length;
    if (topLevel === 2 && groupFields.length >= 2) {
      groupFields[0]!.width = "half";
      groupFields[1]!.width = "half";
    }
    fields.push(...groupFields);
  }

  if (raw.legalConsentOptions && Object.keys(raw.legalConsentOptions).length) {
    skipped.push({ code: "legal-consent" });
  }

  const postSubmit = raw.configuration?.postSubmitAction;

  return {
    name: raw.name ?? "",
    submitLabel: raw.displayOptions?.submitButtonText || null,
    successMessage:
      postSubmit?.type === "thank_you" && postSubmit.value ? postSubmit.value : null,
    // HubSpot forms are single-page: one step, reorganizable in the builder.
    definition: { version: 1, steps: [{ id: makeId("stp"), fields }] },
    skipped,
  };
}

/* ------------------------------------------------------------------ */
/* Portal access                                                       */
/* ------------------------------------------------------------------ */

async function hsGet<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${HS_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw Object.assign(new Error(body.message || `HubSpot ${res.status}`), {
      status: res.status,
    });
  }
  return (await res.json()) as T;
}

/** Every regular form of the portal, name-sorted. Needs the `forms` scope. */
export async function listHubspotForms(apiKey: string): Promise<HubspotFormSummary[]> {
  const out: HubspotFormSummary[] = [];
  let after: string | undefined;
  // Paging cap: nobody imports from a portal with 1000+ forms one by one.
  for (let page = 0; page < 10; page += 1) {
    const query = after ? `&after=${encodeURIComponent(after)}` : "";
    const res = await hsGet<{
      results?: { id?: string; name?: string; updatedAt?: string; archived?: boolean }[];
      paging?: { next?: { after?: string } };
    }>(apiKey, `/marketing/v3/forms/?limit=100&formTypes=hubspot${query}`);
    for (const form of res.results ?? []) {
      if (form.id && !form.archived) {
        out.push({ id: form.id, name: form.name || form.id, updatedAt: form.updatedAt });
      }
    }
    after = res.paging?.next?.after;
    if (!after) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One form, full definition. */
export async function fetchHubspotForm(apiKey: string, formId: string): Promise<RawHubspotForm> {
  return hsGet<RawHubspotForm>(apiKey, `/marketing/v3/forms/${encodeURIComponent(formId)}`);
}
