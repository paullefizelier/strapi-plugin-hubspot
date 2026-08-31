import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export { arrayMove };

/** The drag-handle props to spread on the grip element. */
export interface HandleProps {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, unknown> | undefined;
}

/**
 * One vertical sortable list. Each list gets its OWN DndContext: steps sort
 * among steps, a step's fields sort among themselves — no cross-container
 * ambiguity, and the arrow buttons keep covering cross-step moves (they also
 * stay the accessible path).
 */
export function SortableList({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  /** Called with the reordered ids after a completed drag. */
  onReorder: (ids: string[]) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // An 8px activation distance keeps clicks (selection!) from starting drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** A sortable row: wraps the card, hands the grip props to its children. */
export function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: HandleProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
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
