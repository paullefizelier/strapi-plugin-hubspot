import * as React from "react";
import { useIntl } from "react-intl";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from "@strapi/design-system";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash } from "@strapi/icons";
import { useFetchClient } from "@strapi/strapi/admin";
import ConditionEditor from "../builder/ConditionEditor";
import FieldPanel from "../builder/FieldPanel";
import {
  fieldsBefore,
  makeId,
  type DefinitionError,
  type FormEntryDto,
  type FormField,
  type FormStep,
  type MappingProblem,
} from "../builder/types";
import { getTranslation } from "../getTranslation";
import { PLUGIN_ID } from "../pluginId";

type Selection = { kind: "form" } | { kind: "step"; stepId: string } | { kind: "field"; fieldId: string };

interface AdminLocale {
  code: string;
  name: string;
  isDefault: boolean;
}

const newField = (label: string): FormField => ({
  id: makeId("fld"),
  name: "",
  label,
  type: "text",
  width: "full",
  hubspot: { object: "contact" },
});

const newStep = (): FormStep => ({ id: makeId("stp"), title: "", fields: [] });

/**
 * The builder: steps and field cards on the left (reordered with the arrows —
 * a field pushed past the edge of its step slides into the neighbour), the
 * properties of the selection on the right, save/publish on top. Structure
 * problems and CRM mapping problems land as badges on the cards they concern.
 */
const FormEditor = () => {
  const { formatMessage } = useIntl();
  const { get, post, put } = useFetchClient();
  const { documentId } = useParams<{ documentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const locale = searchParams.get("locale") ?? undefined;

  const [entry, setEntry] = React.useState<FormEntryDto | null>(null);
  const [published, setPublished] = React.useState(false);
  const [locales, setLocales] = React.useState<AdminLocale[]>([]);
  const [selection, setSelection] = React.useState<Selection>({ kind: "form" });
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<DefinitionError[]>([]);
  const [problems, setProblems] = React.useState<MappingProblem[]>([]);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const t = (id: string, defaultMessage: string, values?: Record<string, string | number>) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const query = locale ? `?locale=${locale}` : "";

  React.useEffect(() => {
    get<AdminLocale[]>("/i18n/locales")
      .then(({ data }) => Array.isArray(data) && setLocales(data))
      .catch(() => setLocales([]));
  }, [get]);

  React.useEffect(() => {
    let cancelled = false;
    setEntry(null);
    setSelection({ kind: "form" });
    setErrors([]);
    setProblems([]);
    get<{ form: FormEntryDto; published: boolean }>(
      `/${PLUGIN_ID}/builder/forms/${documentId}${query}`,
    )
      .then(({ data }) => {
        if (cancelled) return;
        setEntry(data.form);
        setPublished(data.published);
        setDirty(false);
      })
      .catch(async () => {
        if (cancelled || !locale) return;
        // This locale doesn't exist yet: start it from the default locale's
        // structure, ready to be translated and saved.
        try {
          const { data } = await get<{ form: FormEntryDto }>(
            `/${PLUGIN_ID}/builder/forms/${documentId}`,
          );
          if (cancelled) return;
          setEntry({ ...data.form, locale });
          setPublished(false);
          setDirty(true);
          setFeedback({
            tone: "success",
            text: t("editor.locale-copied", "New locale started from the default structure — save to keep it."),
          });
        } catch {
          if (!cancelled) setFeedback({ tone: "danger", text: t("editor.load-error", "Could not load the form.") });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, locale]);

  if (!entry) {
    return (
      <Box padding={8}>
        <Loader>{t("editor.loading", "Loading…")}</Loader>
      </Box>
    );
  }

  const definition = entry.definition ?? { version: 1, steps: [] };

  const patchEntry = (patch: Partial<FormEntryDto>) => {
    setEntry((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };

  const patchDefinition = (mutate: (steps: FormStep[]) => FormStep[]) =>
    patchEntry({ definition: { version: 1, steps: mutate(definition.steps) } });

  const patchField = (fieldId: string, patch: Partial<FormField>) =>
    patchDefinition((steps) =>
      steps.map((step) => ({
        ...step,
        fields: step.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
      })),
    );

  const patchStep = (stepId: string, patch: Partial<FormStep>) =>
    patchDefinition((steps) => steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));

  /** Move a field up/down; past the edge of its step it enters the neighbour. */
  const moveField = (stepIndex: number, fieldIndex: number, delta: -1 | 1) =>
    patchDefinition((steps) => {
      const next = steps.map((s) => ({ ...s, fields: [...s.fields] }));
      const from = next[stepIndex];
      const [field] = from.fields.splice(fieldIndex, 1);
      const target = fieldIndex + delta;
      if (target >= 0 && target <= from.fields.length) {
        from.fields.splice(target, 0, field);
      } else if (delta === -1 && next[stepIndex - 1]) {
        next[stepIndex - 1].fields.push(field);
      } else if (delta === 1 && next[stepIndex + 1]) {
        next[stepIndex + 1].fields.unshift(field);
      } else {
        from.fields.splice(fieldIndex, 0, field); // nowhere to go — put it back
      }
      return next;
    });

  const moveStep = (stepIndex: number, delta: -1 | 1) =>
    patchDefinition((steps) => {
      const target = stepIndex + delta;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      const [step] = next.splice(stepIndex, 1);
      next.splice(target, 0, step);
      return next;
    });

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setFeedback(null);
    setErrors([]);
    try {
      const { data } = await put<{ form: FormEntryDto; problems: MappingProblem[] }>(
        `/${PLUGIN_ID}/builder/forms/${documentId}${query}`,
        {
          name: entry.name,
          title: entry.title,
          subtitle: entry.subtitle,
          nextLabel: entry.nextLabel,
          submitLabel: entry.submitLabel,
          successMessage: entry.successMessage,
          definition,
        },
      );
      setProblems(data.problems ?? []);
      setDirty(false);
      setFeedback({ tone: "success", text: t("editor.saved", "Draft saved.") });
      return true;
    } catch (err) {
      const data = (err as { response?: { data?: { errors?: DefinitionError[] } } }).response?.data;
      if (data?.errors) {
        setErrors(data.errors);
        setFeedback({ tone: "danger", text: t("editor.invalid", "The structure has problems — see the flagged cards.") });
      } else {
        setFeedback({ tone: "danger", text: t("editor.save-error", "Could not save the form.") });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    setFeedback(null);
    try {
      await post(`/${PLUGIN_ID}/builder/forms/${documentId}/publish${query}`);
      setPublished(true);
      setErrors([]);
      setProblems([]);
      setFeedback({ tone: "success", text: t("editor.published", "Form published.") });
    } catch (err) {
      const data = (err as {
        response?: { data?: { errors?: DefinitionError[]; problems?: MappingProblem[] } };
      }).response?.data;
      setErrors(data?.errors ?? []);
      setProblems(data?.problems ?? []);
      setFeedback({
        tone: "danger",
        text: t("editor.publish-blocked", "Publishing is blocked — fix the flagged mappings first."),
      });
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    setBusy(true);
    try {
      await post(`/${PLUGIN_ID}/builder/forms/${documentId}/unpublish${query}`);
      setPublished(false);
      setFeedback({ tone: "success", text: t("editor.unpublished", "Form unpublished.") });
    } catch {
      setFeedback({ tone: "danger", text: t("editor.unpublish-error", "Could not unpublish.") });
    } finally {
      setBusy(false);
    }
  };

  const fieldFlags = (fieldId: string) => ({
    error: errors.find((e) => e.fieldId === fieldId),
    problem: problems.find((p) => p.fieldId === fieldId),
  });

  const selectedField =
    selection.kind === "field"
      ? definition.steps.flatMap((s) => s.fields).find((f) => f.id === selection.fieldId)
      : undefined;
  const selectedStep =
    selection.kind === "step" ? definition.steps.find((s) => s.id === selection.stepId) : undefined;

  return (
    <Box padding={6}>
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="center" paddingBottom={4}>
        <Flex gap={3} alignItems="center">
          <Link to={`/plugins/${PLUGIN_ID}`}>
            <IconButton label={t("editor.back", "Back to the list")} tag="span">
              <ArrowLeft />
            </IconButton>
          </Link>
          <Box>
            <Flex gap={2} alignItems="center">
              <Typography variant="beta" tag="h1">
                {entry.name}
              </Typography>
              {published ? (
                <Badge backgroundColor="success100" textColor="success700">
                  {t("forms.published", "Published")}
                </Badge>
              ) : (
                <Badge backgroundColor="secondary100" textColor="secondary700">
                  {t("forms.draft", "Draft")}
                </Badge>
              )}
              {dirty && (
                <Badge backgroundColor="warning100" textColor="warning700">
                  {t("editor.unsaved", "Unsaved changes")}
                </Badge>
              )}
            </Flex>
            <Typography variant="pi" textColor="neutral600">
              /{entry.slug}
            </Typography>
          </Box>
        </Flex>
        <Flex gap={2}>
          {locales.length > 1 && (
            <SingleSelect
              aria-label={t("editor.locale", "Locale")}
              value={locale ?? locales.find((l) => l.isDefault)?.code ?? ""}
              onChange={(v: string | number) => {
                const code = String(v);
                const isDefault = locales.find((l) => l.isDefault)?.code === code;
                setSearchParams(isDefault ? {} : { locale: code });
              }}
            >
              {locales.map((l) => (
                <SingleSelectOption key={l.code} value={l.code}>
                  {l.name}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          )}
          <Button variant="secondary" onClick={save} disabled={busy || !dirty}>
            {t("editor.save", "Save")}
          </Button>
          <Button onClick={publish} disabled={busy}>
            {t("editor.publish", "Publish")}
          </Button>
          {published && (
            <Button variant="tertiary" onClick={unpublish} disabled={busy}>
              {t("editor.unpublish", "Unpublish")}
            </Button>
          )}
        </Flex>
      </Flex>

      {feedback && (
        <Box paddingBottom={4}>
          <Typography textColor={feedback.tone === "success" ? "success600" : "danger600"}>
            {feedback.text}
          </Typography>
        </Box>
      )}

      <Flex gap={6} alignItems="flex-start">
        {/* Canvas */}
        <Box flex="1">
          <Flex direction="column" alignItems="stretch" gap={4}>
            {definition.steps.map((step, stepIndex) => (
              <Box
                key={step.id}
                background="neutral0"
                hasRadius
                shadow="tableShadow"
                padding={4}
                borderColor={selection.kind === "step" && selection.stepId === step.id ? "primary600" : undefined}
                borderStyle={selection.kind === "step" && selection.stepId === step.id ? "solid" : undefined}
                borderWidth={selection.kind === "step" && selection.stepId === step.id ? "1px" : undefined}
              >
                <Flex justifyContent="space-between" alignItems="center" paddingBottom={2}>
                  <Flex
                    gap={2}
                    alignItems="center"
                    onClick={() => setSelection({ kind: "step", stepId: step.id })}
                    style={{ cursor: "pointer" }}
                  >
                    <Typography variant="delta">
                      {t("editor.step", "Step {n}", { n: stepIndex + 1 })}
                      {step.title ? ` — ${step.title}` : ""}
                    </Typography>
                    {step.visibleIf?.rules?.length ? (
                      <Badge backgroundColor="alternative100" textColor="alternative700">
                        {t("editor.conditional", "Conditional")}
                      </Badge>
                    ) : null}
                    {errors.some((e) => e.stepId === step.id) && (
                      <Badge backgroundColor="danger100" textColor="danger700">
                        {t("editor.flag-error", "To fix")}
                      </Badge>
                    )}
                  </Flex>
                  <Flex gap={1}>
                    <IconButton
                      label={t("editor.step-up", "Move the step up")}
                      onClick={() => moveStep(stepIndex, -1)}
                      disabled={stepIndex === 0}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label={t("editor.step-down", "Move the step down")}
                      onClick={() => moveStep(stepIndex, 1)}
                      disabled={stepIndex === definition.steps.length - 1}
                    >
                      <ArrowDown />
                    </IconButton>
                    <IconButton
                      label={t("editor.step-delete", "Delete the step and its fields")}
                      onClick={() => {
                        setSelection({ kind: "form" });
                        patchDefinition((steps) => steps.filter((s) => s.id !== step.id));
                      }}
                    >
                      <Trash />
                    </IconButton>
                  </Flex>
                </Flex>

                <Flex direction="column" alignItems="stretch" gap={2}>
                  {step.fields.map((field, fieldIndex) => {
                    const flags = fieldFlags(field.id);
                    const isSelected = selection.kind === "field" && selection.fieldId === field.id;
                    return (
                      <Box
                        key={field.id}
                        background={isSelected ? "primary100" : "neutral100"}
                        hasRadius
                        padding={3}
                        onClick={() => setSelection({ kind: "field", fieldId: field.id })}
                        style={{ cursor: "pointer" }}
                      >
                        <Flex justifyContent="space-between" alignItems="center">
                          <Flex gap={2} alignItems="center" wrap="wrap">
                            <Typography fontWeight="semiBold">{field.label || field.name || "—"}</Typography>
                            <Badge>{field.type}</Badge>
                            {field.required && (
                              <Badge backgroundColor="neutral150" textColor="neutral600">
                                {t("editor.required", "required")}
                              </Badge>
                            )}
                            {field.hubspot?.property && (
                              <Badge backgroundColor="primary100" textColor="primary700">
                                {field.hubspot.object ?? "contact"}.{field.hubspot.property}
                              </Badge>
                            )}
                            {field.visibleIf?.rules?.length ? (
                              <Badge backgroundColor="alternative100" textColor="alternative700">
                                {t("editor.conditional", "Conditional")}
                              </Badge>
                            ) : null}
                            {(flags.error || flags.problem) && (
                              <Badge backgroundColor="danger100" textColor="danger700">
                                {flags.error?.code ?? flags.problem?.code}
                              </Badge>
                            )}
                          </Flex>
                          <Flex gap={1} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            <IconButton
                              label={t("editor.field-up", "Move up")}
                              onClick={() => moveField(stepIndex, fieldIndex, -1)}
                              disabled={stepIndex === 0 && fieldIndex === 0}
                            >
                              <ArrowUp />
                            </IconButton>
                            <IconButton
                              label={t("editor.field-down", "Move down")}
                              onClick={() => moveField(stepIndex, fieldIndex, 1)}
                              disabled={
                                stepIndex === definition.steps.length - 1 &&
                                fieldIndex === step.fields.length - 1
                              }
                            >
                              <ArrowDown />
                            </IconButton>
                            <IconButton
                              label={t("editor.field-delete", "Delete the field")}
                              onClick={() => {
                                setSelection({ kind: "form" });
                                patchStep(step.id, {
                                  fields: step.fields.filter((f) => f.id !== field.id),
                                });
                              }}
                            >
                              <Trash />
                            </IconButton>
                          </Flex>
                        </Flex>
                      </Box>
                    );
                  })}
                  <Button
                    variant="tertiary"
                    startIcon={<Plus />}
                    onClick={() => {
                      const field = newField(t("editor.new-field", "New field"));
                      patchStep(step.id, { fields: [...step.fields, field] });
                      setSelection({ kind: "field", fieldId: field.id });
                    }}
                  >
                    {t("editor.add-field", "Add a field")}
                  </Button>
                </Flex>
              </Box>
            ))}

            <Button
              variant="secondary"
              startIcon={<Plus />}
              onClick={() => {
                const step = newStep();
                patchDefinition((steps) => [...steps, step]);
                setSelection({ kind: "step", stepId: step.id });
              }}
            >
              {t("editor.add-step", "Add a step")}
            </Button>
          </Flex>
        </Box>

        {/* Side panel */}
        <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} width="380px" style={{ flexShrink: 0 }}>
          {selectedField ? (
            <FieldPanel
              field={selectedField}
              candidates={fieldsBefore(definition, selectedField.id)}
              problem={problems.find((p) => p.fieldId === selectedField.id)}
              onChange={(patch) => patchField(selectedField.id, patch)}
            />
          ) : selectedStep ? (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Typography variant="sigma" textColor="neutral600">
                {t("editor.step-panel", "Step")}
              </Typography>
              <Field.Root>
                <Field.Label>{t("editor.step-title", "Title")}</Field.Label>
                <TextInput
                  value={selectedStep.title ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    patchStep(selectedStep.id, { title: e.target.value })
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t("editor.step-description", "Description")}</Field.Label>
                <Textarea
                  value={selectedStep.description ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    patchStep(selectedStep.id, { description: e.target.value })
                  }
                />
              </Field.Root>
              <Typography variant="sigma" textColor="neutral600">
                {t("editor.step-condition", "Show this step only when…")}
              </Typography>
              <ConditionEditor
                condition={selectedStep.visibleIf}
                candidates={fieldsBefore(definition, selectedStep.id)}
                onChange={(visibleIf) => patchStep(selectedStep.id, { visibleIf })}
              />
            </Flex>
          ) : (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Typography variant="sigma" textColor="neutral600">
                {t("editor.form-panel", "Form")}
              </Typography>
              <Field.Root>
                <Field.Label>{t("editor.form-name", "Internal name")}</Field.Label>
                <TextInput
                  value={entry.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => patchEntry({ name: e.target.value })}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t("editor.form-title", "Title")}</Field.Label>
                <TextInput
                  value={entry.title ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => patchEntry({ title: e.target.value })}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>{t("editor.form-subtitle", "Subtitle")}</Field.Label>
                <Textarea
                  value={entry.subtitle ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    patchEntry({ subtitle: e.target.value })
                  }
                />
              </Field.Root>
              <Flex gap={2}>
                <Box flex="1">
                  <Field.Root>
                    <Field.Label>{t("editor.form-next", "Next label")}</Field.Label>
                    <TextInput
                      value={entry.nextLabel ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        patchEntry({ nextLabel: e.target.value })
                      }
                    />
                  </Field.Root>
                </Box>
                <Box flex="1">
                  <Field.Root>
                    <Field.Label>{t("editor.form-submit", "Submit label")}</Field.Label>
                    <TextInput
                      value={entry.submitLabel ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        patchEntry({ submitLabel: e.target.value })
                      }
                    />
                  </Field.Root>
                </Box>
              </Flex>
              <Field.Root>
                <Field.Label>{t("editor.form-success", "Success message")}</Field.Label>
                <Textarea
                  value={entry.successMessage ?? ""}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    patchEntry({ successMessage: e.target.value })
                  }
                />
              </Field.Root>
              <Typography variant="pi" textColor="neutral600">
                {t(
                  "editor.form-hint",
                  "Select a step or a field to edit it. The public endpoint serves this form at /api/hubspot/forms/{slug}.",
                  { slug: entry.slug },
                )}
              </Typography>
            </Flex>
          )}
        </Box>
      </Flex>
    </Box>
  );
};

export default FormEditor;
