import * as React from "react";
import { useIntl } from "react-intl";
import {
  Box,
  Button,
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from "@strapi/design-system";
import { Plus, Trash } from "@strapi/icons";
import { getTranslation } from "../getTranslation";
import type { Condition, FormField, Operator, Rule } from "./types";

const OPERATORS: Operator[] = ["eq", "neq", "contains", "empty", "notEmpty", "gt", "lt"];
const NEEDS_VALUE = new Set<Operator>(["eq", "neq", "contains", "gt", "lt"]);

interface Props {
  /** The condition being edited (null/undefined = always visible). */
  condition: Condition | null | undefined;
  /** Fields a rule may reference — only the ones BEFORE the owner. */
  candidates: FormField[];
  onChange: (condition: Condition | null) => void;
}

/**
 * "[earlier field ▾] [operator ▾] [value]" rows joined by AND/OR. Only earlier
 * fields are offered, so the engine's single forward pass always has what a
 * rule reads. The value input becomes a select when the referenced field has
 * declared options.
 */
const ConditionEditor = ({ condition, candidates, onChange }: Props) => {
  const { formatMessage } = useIntl();
  const t = (id: string, defaultMessage: string) =>
    formatMessage({ id: getTranslation(id), defaultMessage });

  const opLabel: Record<Operator, string> = {
    eq: t("condition.op.eq", "is"),
    neq: t("condition.op.neq", "is not"),
    contains: t("condition.op.contains", "contains"),
    empty: t("condition.op.empty", "is empty"),
    notEmpty: t("condition.op.notEmpty", "is filled"),
    gt: t("condition.op.gt", "is greater than"),
    lt: t("condition.op.lt", "is less than"),
  };

  const rules = condition?.rules ?? [];
  const logic = condition?.logic ?? "and";

  const commit = (nextRules: Rule[], nextLogic: "and" | "or" = logic) =>
    onChange(nextRules.length ? { logic: nextLogic, rules: nextRules } : null);

  const updateRule = (index: number, patch: Partial<Rule>) =>
    commit(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const addRule = () => {
    const first = candidates[0];
    if (!first) return;
    commit([...rules, { field: first.id, operator: "eq", value: "" }]);
  };

  if (!candidates.length) {
    return (
      <Typography variant="pi" textColor="neutral600">
        {t("condition.no-candidates", "Conditions can only read fields placed earlier in the form.")}
      </Typography>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={2}>
      {rules.map((rule, index) => {
        const target = candidates.find((f) => f.id === rule.field);
        const targetOptions = target?.options?.filter((o) => o.value) ?? [];
        return (
          <Box key={index} background="neutral100" hasRadius padding={2}>
            <Flex gap={2} alignItems="center" wrap="wrap">
              {index > 0 && (
                <Typography variant="sigma" textColor="neutral600">
                  {logic === "and" ? t("condition.and", "AND") : t("condition.or", "OR")}
                </Typography>
              )}
              <Box flex="1" minWidth="120px">
                <SingleSelect
                  aria-label={t("condition.field", "Field")}
                  value={rule.field}
                  onChange={(v: string | number) => updateRule(index, { field: String(v), value: "" })}
                >
                  {candidates.map((f) => (
                    <SingleSelectOption key={f.id} value={f.id}>
                      {f.label || f.name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              <Box flex="1" minWidth="110px">
                <SingleSelect
                  aria-label={t("condition.operator", "Operator")}
                  value={rule.operator}
                  onChange={(v: string | number) => updateRule(index, { operator: v as Operator })}
                >
                  {OPERATORS.map((op) => (
                    <SingleSelectOption key={op} value={op}>
                      {opLabel[op]}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
              {NEEDS_VALUE.has(rule.operator) && (
                <Box flex="1" minWidth="110px">
                  {targetOptions.length ? (
                    <SingleSelect
                      aria-label={t("condition.value", "Value")}
                      value={rule.value ?? ""}
                      onChange={(v: string | number) => updateRule(index, { value: String(v) })}
                    >
                      {targetOptions.map((o) => (
                        <SingleSelectOption key={o.value} value={o.value}>
                          {o.label || o.value}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                  ) : (
                    <TextInput
                      aria-label={t("condition.value", "Value")}
                      value={rule.value ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateRule(index, { value: e.target.value })
                      }
                    />
                  )}
                </Box>
              )}
              <IconButton
                label={t("condition.remove-rule", "Remove this rule")}
                onClick={() => commit(rules.filter((_, i) => i !== index))}
              >
                <Trash />
              </IconButton>
            </Flex>
          </Box>
        );
      })}

      <Flex gap={2}>
        <Button variant="tertiary" size="S" startIcon={<Plus />} onClick={addRule}>
          {t("condition.add-rule", "Add a rule")}
        </Button>
        {rules.length > 1 && (
          <SingleSelect
            aria-label={t("condition.logic", "Logic")}
            value={logic}
            onChange={(v: string | number) => commit(rules, v as "and" | "or")}
          >
            <SingleSelectOption value="and">
              {t("condition.logic-and", "All rules (AND)")}
            </SingleSelectOption>
            <SingleSelectOption value="or">
              {t("condition.logic-or", "At least one (OR)")}
            </SingleSelectOption>
          </SingleSelect>
        )}
      </Flex>
    </Flex>
  );
};

export default ConditionEditor;
