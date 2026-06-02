import { Palette } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useKanbanDefaultColors } from '@/presentation/hooks/useKanbanDefaultColors';
import { KanbanColorPicker } from '@/presentation/components/tasks/KanbanColorPicker';
import { STATUS_LABEL } from '@/presentation/components/tasks/statusLabels';
import {
  BUILTIN_KANBAN_COLORS,
  VISIBLE_KANBAN_STATUSES,
} from '@/domain/kanban/KanbanSettings';

// Глобальные дефолтные цвета канбан-колонок. Применяются к НОВЫМ проектам; в конкретном
// проекте цвет переопределяется через меню колонки (⋯). Резолв — на лету, без копирования.
export function KanbanColorsCard(): React.ReactElement {
  const { colors, loading, setColor } = useKanbanDefaultColors();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="size-5 text-primary" />
          <CardTitle>Цвета канбан-колонок по умолчанию</CardTitle>
        </div>
        <CardDescription>
          Применяются к новым проектам. В конкретном проекте цвет колонки можно
          переопределить через меню «⋯» в её заголовке.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {VISIBLE_KANBAN_STATUSES.map((status) => (
          <div key={status} className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{STATUS_LABEL[status]}</span>
            <KanbanColorPicker
              value={colors?.[status] ?? BUILTIN_KANBAN_COLORS[status]}
              onChange={(c) => setColor(status, c)}
              includeDefault={false}
              className={loading ? 'pointer-events-none opacity-50' : ''}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
