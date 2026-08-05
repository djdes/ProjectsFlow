import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CUSTOM_KANBAN_SLOTS } from '@/domain/kanban/KanbanSettings';

type Props = {
  // Сколько кастомных колонок уже заведено — на пределе кнопка не показывается.
  activeCount: number;
  onCreate: (label: string) => Promise<unknown>;
};

// Кнопка «+ Колонка» в конце ряда колонок доски: имя вводится тут же, без диалога
// (как inline-создание задачи). Слот под колонку выбирает сервер.
export function KanbanAddColumnButton({ activeCount, onCreate }: Props): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  if (activeCount >= CUSTOM_KANBAN_SLOTS.length) return null;

  const submit = async (): Promise<void> => {
    const name = label.trim();
    if (name.length === 0 || saving) return;
    setSaving(true);
    await onCreate(name);
    setSaving(false);
    setLabel('');
    setOpen(false);
  };

  return (
    <div className="flex shrink-0 items-start pt-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setLabel('');
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground">
            <Plus className="size-4" />
            Колонка
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2">
          <p className="text-xs text-muted-foreground">Название новой колонки</p>
          <Input
            autoFocus
            value={label}
            maxLength={40}
            placeholder="Например: Ревью"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <Button
            size="sm"
            className="w-full"
            disabled={label.trim().length === 0 || saving}
            onClick={() => void submit()}
          >
            Создать
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
