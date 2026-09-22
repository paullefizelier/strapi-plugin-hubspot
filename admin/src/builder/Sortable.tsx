import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { arrayMove, relocateField } from "./relocateField";

export { arrayMove, relocateField };
export type { DragEndEvent };

/** The drag-handle props to spread on the grip element. */
export interface HandleProps {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
}

export type SortableData =
  | { type: "step" }
  | { type: "field"; stepId: string }
  | { type: "container"; stepId: string };

/**
 * One board, two kinds of items: steps sort among steps, fields sort among
 * fields — including across steps. A single DndContext is what makes the
 * cross-step drop possible; collision detection is filtered by `type` so a
 * field drag never reorders the step cards.
 */
const collisionDetection: CollisionDetection = (args) => {
  const type = args.active.data.current?.type;
  const droppableContainers = args.droppableContainers.filter((container) => {
    const other = container.data.current?.type;
    if (type === "step") return other === "step";
    if (type === "field") return other === "field" || other === "container";
    return true;
  });
  return closestCorners({ ...args, droppableContainers });
};

export function SortableBoard({
  children,
  onDragEnd,
}: {
  children: React.ReactNode;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    // An 8px activation distance keeps clicks (selection!) from starting drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}

export function SortableGroup({
  ids,
  children,
}: {
  ids: string[];
  children: React.ReactNode;
}) {
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

/** Drop target for a step's field list — including when the list is empty. */
export function SortableContainer({
  stepId,
  children,
}: {
  stepId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `container:${stepId}`,
    data: { type: "container", stepId } satisfies SortableData,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 8,
        borderRadius: 4,
        outline: isOver ? "2px dashed currentColor" : undefined,
        outlineOffset: 4,
      }}
    >
      {children}
    </div>
  );
}

/** A sortable row: wraps the card, hands the grip props to its children. */
export function SortableItem({
  id,
  data,
  children,
}: {
  id: string;
  data?: SortableData;
  children: (handle: HandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : undefined,
        zIndex: isDragging ? 2 : undefined,
        position: "relative",
      }}
    >
      {children({ attributes: attributes as React.HTMLAttributes<HTMLElement>, listeners })}
    </div>
  );
}
