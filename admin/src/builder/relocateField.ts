import { arrayMove } from "@dnd-kit/sortable";

export { arrayMove };

/**
 * Move `fieldId` onto `overId` across steps.
 *
 * `overId` is another field (insert at that index), a step id (append),
 * or `container:${stepId}` (the empty-area droppable of that step).
 */
export function relocateField<S extends { id: string; fields: F[] }, F extends { id: string }>(
  steps: S[],
  fieldId: string,
  overId: string,
): S[] {
  const next = steps.map((step) => ({ ...step, fields: [...step.fields] }));
  let fromStep = -1;
  let fromIndex = -1;
  for (let i = 0; i < next.length; i += 1) {
    const index = next[i]!.fields.findIndex((field) => field.id === fieldId);
    if (index !== -1) {
      fromStep = i;
      fromIndex = index;
      break;
    }
  }
  if (fromStep === -1) return steps;

  let toStep = -1;
  let toIndex = -1;
  const containerId = overId.startsWith("container:") ? overId.slice("container:".length) : "";
  if (containerId) {
    toStep = next.findIndex((step) => step.id === containerId);
    toIndex = toStep === -1 ? -1 : next[toStep]!.fields.length;
  } else {
    for (let i = 0; i < next.length; i += 1) {
      const index = next[i]!.fields.findIndex((field) => field.id === overId);
      if (index !== -1) {
        toStep = i;
        toIndex = index;
        break;
      }
    }
    if (toStep === -1) {
      toStep = next.findIndex((step) => step.id === overId);
      toIndex = toStep === -1 ? -1 : next[toStep]!.fields.length;
    }
  }
  if (toStep === -1 || toIndex === -1) return steps;
  if (fromStep === toStep) {
    if (fromIndex === toIndex) return steps;
    next[fromStep]!.fields = arrayMove(next[fromStep]!.fields, fromIndex, toIndex);
    return next;
  }
  const [field] = next[fromStep]!.fields.splice(fromIndex, 1);
  if (!field) return steps;
  next[toStep]!.fields.splice(toIndex, 0, field);
  return next;
}
