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
