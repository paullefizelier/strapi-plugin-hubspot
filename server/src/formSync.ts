/**
 * Policy helpers for HubSpot form field sync and leftover CRM writes.
 *
 * Two independent user wills, neither assumed:
 *  - Strapi-first: mapped contact fields missing on the HubSpot form can be
 *    PATCHed onto it at publish time (opt-in).
 *  - HubSpot-first: extras must not 400 the Forms API submit, but they can
 *    still land on the contact via a CRM upsert of the leftovers.
 *
 * CRM properties are never created here — the picker only maps to ones that
 * already exist on the portal.
 */

import type { FormDefinition } from "./conditions";

export interface MappedFormField {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  object?: string;
  property: string;
  options?: { value?: string; label?: string }[];
}

const OBJECT_TYPE_ID: Record<string, string> = {
  contact: "0-1",
  company: "0-2",
};

export function leftoverContactProps(
  contact: Record<string, string>,
  sentFieldNames: Iterable<string>,
): Record<string, string> {
  const sent = new Set(sentFieldNames);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(contact)) {
    if (key === "email" || sent.has(key) || value === "") continue;
    extra[key] = value;
  }
  return extra;
}

export function mappedContactFields(definition: FormDefinition): MappedFormField[] {
  const out: MappedFormField[] = [];
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      if (fld.type === "company") continue;
      const mapping = (fld.hubspot ?? {}) as { object?: string; property?: string };
      const object = mapping.object?.trim() || "contact";
      if (object !== "contact") continue;
      const property = mapping.property?.trim() || fld.name;
      if (!property) continue;
      out.push({
        name: fld.name,
        label: typeof fld.label === "string" ? fld.label : undefined,
        type: fld.type,
        required: Boolean(fld.required),
        object,
        property,
        options: fld.options as { value?: string; label?: string }[] | undefined,
      });
    }
  }
  return out;
}

export function missingMappedFields(
  definition: FormDefinition,
  existingNames: Iterable<string>,
): MappedFormField[] {
  const existing = new Set(existingNames);
  return mappedContactFields(definition).filter((field) => !existing.has(field.property));
}

const OBJECT_TYPE_BY_NAME: Record<string, string> = {
  contact: "0-1",
  company: "0-2",
};

export interface MissingHubspotRequired {
  name: string;
  objectTypeId: string;
  object: string;
}

/** Properties the Strapi form can actually send (`objectTypeId:property`). */
export function collectedHubspotKeys(definition: FormDefinition): Set<string> {
  const keys = new Set<string>();
  const add = (object: string, property: string) => {
    const typeId = OBJECT_TYPE_BY_NAME[object] || object;
    if (property) keys.add(`${typeId}:${property}`);
  };
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      if (fld.type === "company") {
        const map = (fld.companyMap ?? {}) as Record<string, { object?: string; property?: string }>;
        for (const slot of Object.values(map)) {
          if (slot?.property?.trim()) add(slot.object?.trim() || "company", slot.property.trim());
        }
        continue;
      }
      const mapping = (fld.hubspot ?? {}) as { object?: string; property?: string };
      const object = mapping.object?.trim() || "contact";
      const property = mapping.property?.trim() || fld.name;
      if (property) add(object, property);
    }
  }
  return keys;
}

/**
 * Required marketing-form fields the Strapi form never collects. HubSpot
 * rejects the whole conversion when one of these is absent.
 */
export function missingRequiredHubspotFields(
  definition: FormDefinition,
  required: { name: string; objectTypeId?: string }[],
): MissingHubspotRequired[] {
  const collected = collectedHubspotKeys(definition);
  const missing: MissingHubspotRequired[] = [];
  for (const field of required) {
    if (!field.name) continue;
    const objectTypeId = field.objectTypeId?.trim() || "0-1";
    if (collected.has(`${objectTypeId}:${field.name}`)) continue;
    missing.push({
      name: field.name,
      objectTypeId,
      object: objectTypeId === "0-2" ? "company" : "contact",
    });
  }
  return missing;
}

export function hsFieldType(type: string, options?: unknown[]): string {
  switch (type) {
    case "email":
      return "email";
    case "tel":
      return "phone";
    case "textarea":
      return "multi_line_text";
    case "number":
      return "number";
    case "select":
      return "dropdown";
    case "radio":
      return "radio";
    case "checkbox":
      return Array.isArray(options) && options.length ? "multiple_checkboxes" : "booleancheckbox";
    default:
      return "single_line_text";
  }
}

export function toHsFormField(field: MappedFormField): Record<string, unknown> {
  const options = (field.options ?? [])
    .filter((option) => option.value)
    .map((option) => ({
      value: String(option.value),
      label: option.label || String(option.value),
    }));
  return {
    objectTypeId: OBJECT_TYPE_ID[field.object || "contact"] || "0-1",
    name: field.property,
    label: field.label || field.property,
    required: Boolean(field.required),
    hidden: false,
    fieldType: hsFieldType(field.type, field.options),
    ...(options.length ? { options } : {}),
  };
}

export interface RawFieldGroupLike {
  groupType?: string;
  richTextType?: string;
  richText?: string;
  fields?: unknown[];
}

export function appendFieldGroups(
  existing: RawFieldGroupLike[],
  extra: MappedFormField[],
): Record<string, unknown>[] {
  return [
    ...existing.map((group) => ({
      groupType: group.groupType || "default_group",
      richTextType: group.richTextType || "text",
      ...(group.richText ? { richText: group.richText } : {}),
      fields: group.fields ?? [],
    })),
    ...extra.map((field) => ({
      groupType: "default_group",
      richTextType: "text",
      fields: [toHsFormField(field)],
    })),
  ];
}

interface HsFieldNode {
  name?: string;
  objectTypeId?: string;
  dependentFields?: { dependentCondition?: { operator?: string; values?: string[] }; field?: HsFieldNode }[];
  [key: string]: unknown;
}

function conditionToHubspot(
  condition: { logic?: string; rules?: { field: string; operator: string; value?: string }[] },
  parentId: string,
): { operator: string; values: string[] } | null {
  const rules = (condition.rules ?? []).filter((rule) => rule.field === parentId);
  if (!rules.length || rules.length !== (condition.rules ?? []).length) return null;
  const op = rules[0]?.operator;
  if (rules.some((rule) => rule.operator !== op)) return null;
  const values = rules.map((rule) => rule.value).filter((value): value is string => Boolean(value));
  switch (op) {
    case "eq":
      return { operator: values.length > 1 ? "SET_ANY" : "EQ", values };
    case "neq":
      return { operator: values.length > 1 ? "NOT_SET_ANY" : "NEQ", values };
    case "contains":
      return { operator: "CONTAINS", values };
    case "gt":
      return { operator: "GT", values };
    case "lt":
      return { operator: "LT", values };
    case "notEmpty":
      return { operator: "SET", values: [] };
    case "empty":
      return { operator: "NOT_SET", values: [] };
    default:
      return null;
  }
}

/**
 * Nest Strapi `visibleIf` fields under their HubSpot parent as dependentFields.
 * Conditions edited in Strapi are included; unsupported multi-parent rules stay flat.
 */
export function applyVisibleIfToFieldGroups(
  groups: Record<string, unknown>[],
  definition: FormDefinition,
): Record<string, unknown>[] {
  const byId = new Map<string, { name: string; property: string }>();
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      const mapping = (fld.hubspot ?? {}) as { property?: string };
      byId.set(fld.id, { name: fld.name, property: mapping.property?.trim() || fld.name });
    }
  }
  const moves = new Map<string, { parent: string; operator: string; values: string[] }>();
  for (const step of definition.steps ?? []) {
    for (const fld of step.fields ?? []) {
      const visibleIf = fld.visibleIf as
        | { rules?: { field: string; operator: string; value?: string }[] }
        | null
        | undefined;
      const parentId = visibleIf?.rules?.[0]?.field;
      if (!visibleIf || !parentId) continue;
      const converted = conditionToHubspot(visibleIf, parentId);
      const parent = byId.get(parentId);
      const mapping = (fld.hubspot ?? {}) as { property?: string };
      const property = mapping.property?.trim() || fld.name;
      if (!converted || !parent) continue;
      moves.set(property, { parent: parent.property, ...converted });
    }
  }
  if (!moves.size) return groups;

  const cloned = JSON.parse(JSON.stringify(groups)) as { fields?: HsFieldNode[] }[];
  const flat: { group: { fields?: HsFieldNode[] }; index: number; field: HsFieldNode }[] = [];
  for (const group of cloned) {
    (group.fields ?? []).forEach((field, index) => flat.push({ group, index, field }));
  }
  for (const [property, move] of moves) {
    const child = flat.find((item) => item.field.name === property);
    const parent = flat.find((item) => item.field.name === move.parent);
    if (!child || !parent || child === parent) continue;
    parent.field.dependentFields = [
      ...(parent.field.dependentFields ?? []),
      {
        dependentCondition: { operator: move.operator, values: move.values },
        field: child.field,
      },
    ];
    child.group.fields?.splice(child.index, 1);
  }
  return cloned as Record<string, unknown>[];
}
