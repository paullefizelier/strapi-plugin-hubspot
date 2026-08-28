/**
 * Conversion of a host-app form entry (content type + components) into the
 * plugin's definition model — the migration path for forms built before the
 * builder existed. The attribute names default to the shape this plugin's
 * README always documented (steps/fields, hsObject/hsProperty) and every one
 * of them can be remapped for a different host schema.
 */

import type { FormDefinition } from "./conditions";

export interface ImportMap {
  steps?: string;
  fields?: string;
  step?: Partial<Record<"title" | "description" | "class", string>>;
  field?: Partial<
    Record<
      | "label"
      | "name"
      | "object"
      | "property"
      | "type"
      | "placeholder"
      | "required"
      | "icon"
      | "options"
      | "width"
      | "helpText"
      | "class"
      | "persist",
      string
    >
  >;
}

export interface ConvertedForm {
  name: string;
  slug: string;
  title?: string | null;
  subtitle?: string | null;
  nextLabel?: string | null;
  submitLabel?: string | null;
  successMessage?: string | null;
  definition: FormDefinition;
}

let counter = 0;
const makeId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

const slugifyName = (label: string) =>
  label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const FIELD_DEFAULTS: Required<NonNullable<ImportMap["field"]>> = {
  label: "label",
  name: "name",
  object: "hsObject",
  property: "hsProperty",
  type: "type",
  placeholder: "placeholder",
  required: "required",
  icon: "icon",
  options: "options",
  width: "width",
  helpText: "helpText",
  class: "class",
  persist: "persist",
};

const STEP_DEFAULTS: Required<NonNullable<ImportMap["step"]>> = {
  title: "title",
  description: "description",
  class: "class",
};

export function convertLegacyForm(
  entry: Record<string, unknown>,
  map: ImportMap = {},
): ConvertedForm {
  const stepMap = { ...STEP_DEFAULTS, ...map.step };
  const fieldMap = { ...FIELD_DEFAULTS, ...map.field };
  const rawSteps = (entry[map.steps ?? "steps"] ?? []) as Record<string, unknown>[];

  const steps = rawSteps.map((rawStep) => {
    const rawFields = (rawStep[map.fields ?? "fields"] ?? []) as Record<string, unknown>[];
    return {
      id: makeId("stp"),
      title: (rawStep[stepMap.title] as string) ?? undefined,
      description: (rawStep[stepMap.description] as string) ?? undefined,
      class: (rawStep[stepMap.class] as string) ?? undefined,
      fields: rawFields.map((raw) => {
        const label = (raw[fieldMap.label] as string) ?? "";
        const object = (raw[fieldMap.object] as string) ?? undefined;
        const property = (raw[fieldMap.property] as string) ?? undefined;
        const options = (raw[fieldMap.options] as { value?: string; label?: string }[]) ?? [];
        return {
          id: makeId("fld"),
          label,
          name: ((raw[fieldMap.name] as string) || slugifyName(label)) ?? "",
          type: ((raw[fieldMap.type] as string) ?? "text") as never,
          placeholder: (raw[fieldMap.placeholder] as string) ?? undefined,
          required: Boolean(raw[fieldMap.required]),
          icon: (raw[fieldMap.icon] as string) ?? undefined,
          width: (raw[fieldMap.width] as "full" | "half") ?? undefined,
          helpText: (raw[fieldMap.helpText] as string) ?? undefined,
          class: (raw[fieldMap.class] as string) ?? undefined,
          persist: (raw[fieldMap.persist] as "session" | "days30") ?? undefined,
          ...(options.length
            ? { options: options.map((o) => ({ value: o.value ?? "", label: o.label ?? undefined })) }
            : {}),
          ...(object || property ? { hubspot: { object, property } } : {}),
        };
      }),
    };
  });

  return {
    name: (entry.name as string) ?? "",
    slug: (entry.slug as string) ?? "",
    title: (entry.title as string) ?? null,
    subtitle: (entry.subtitle as string) ?? null,
    nextLabel: (entry.nextLabel as string) ?? null,
    submitLabel: (entry.submitLabel as string) ?? null,
    successMessage: (entry.successMessage as string) ?? null,
    definition: { version: 1, steps },
  };
}
