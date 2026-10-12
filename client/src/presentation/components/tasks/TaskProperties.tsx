import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, type LucideIcon } from 'lucide-react';
import { normalizeTaskPropertyOrder, reorderTaskProperties, type TaskPropertyKey } from '@/domain/user/UiPrefs';
import { useContainer } from '@/infrastructure/di/container';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { PropertyRow } from './PropertyRow';

export type TaskProperty = { icon: LucideIcon; label: string; value: ReactNode; visible?: boolean };

export function TaskProperties({ taskId, items }: {
  taskId: string;
  items: Record<TaskPropertyKey, TaskProperty>;
}): React.ReactElement {
  const { userRepository } = useContainer();
  const [order, setOrder] = useState(() => normalizeTaskPropertyOrder(undefined));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const savedOrder = useRef(order);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    const version = ++generation.current;
    setLoading(true);
    // Wait for the previous task's last reorder before reading the account default.
    void saveQueue.current.then(() => userRepository.getUiPrefs()).then((prefs) => {
      if (cancelled || version !== generation.current) return;
      savedOrder.current = normalizeTaskPropertyOrder(prefs.taskPropertyOrder);
      setOrder(savedOrder.current);
    }).catch(() => {
      if (!cancelled) toast.error('Не удалось загрузить порядок свойств');
    }).finally(() => { if (!cancelled) { setLoading(false); setSaving(false); } });
    return () => { cancelled = true; };
  }, [taskId, userRepository]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id || loading) return;
    const next = reorderTaskProperties(order, active.id as TaskPropertyKey, over.id as TaskPropertyKey);
    const version = ++generation.current;
    setOrder(next);
    setSaving(true);
    // Serialize writes: a slow earlier response must not become the global default.
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        await userRepository.setUiPrefs({ taskPropertyOrder: next });
        savedOrder.current = next;
      } catch {
        if (version === generation.current) {
          setOrder(savedOrder.current);
          toast.error('Порядок не сохранился. Попробуйте ещё раз.');
        }
      } finally {
        if (version === generation.current) setSaving(false);
      }
    });
  };
  const visible = order.filter((key) => items[key].visible !== false);
  return (
    <div data-pf-task-properties>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          {visible.map((key) => <SortableProperty key={`${taskId}:${key}`} id={key} item={items[key]} disabled={loading} />)}
        </SortableContext>
      </DndContext>
      <p className="mbs-2 text-meta text-muted-foreground" role="status">
        {saving ? 'Сохраняем порядок…' : 'Удерживайте строку для перестановки. Порядок общий для всех проектов.'}
      </p>
    </div>
  );
}

function SortableProperty({ id, item, disabled }: { id: TaskPropertyKey; item: TaskProperty; disabled: boolean }): React.ReactElement {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const { animations } = useMotion();
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition: animations ? transition : undefined };
  const { onTouchStart, ...handleListeners } = listeners ?? {};
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-pf-task-property={id}
      data-pf-no-swipe
      onTouchStart={(event) => {
        // Picker portals bubble React events through their row; they must not drag it.
        if (event.currentTarget.contains(event.target as Node)) onTouchStart?.(event);
      }}
      onContextMenu={(event) => event.preventDefault()}
      className={cn('touch-pan-y select-none [-webkit-touch-callout:none]', isDragging && 'relative z-10 rounded-md bg-raised shadow-menu')}
    >
      <PropertyRow icon={item.icon} label={item.label} handle={
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...handleListeners}
          disabled={disabled}
          aria-label={`Переместить «${item.label}»`}
          title="Удерживайте и перетащите. С клавиатуры: пробел и стрелки."
          className="relative grid size-4 cursor-grab place-items-center rounded text-muted-foreground after:absolute after:-inset-3 active:cursor-grabbing active:bg-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        ><GripVertical className="size-3.5" /></button>
      }>{item.value}</PropertyRow>
    </div>
  );
}
