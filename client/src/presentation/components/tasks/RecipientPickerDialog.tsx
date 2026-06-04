import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { SharedMember } from '@/application/project/ProjectRepository';
import type { DigestRecipient } from '@/application/task/TaskRepository';

// Ключи-сентинелы в множестве выбора (не пересекаются с UUID участников).
const SELF_KEY = 'self';
const GROUP_KEY = '__group__';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  members: SharedMember[] | null;
  busy: boolean;
  onSend: (recipients: DigestRecipient[]) => void;
  // Telegram-группа проекта (показываем строку «В группу», если настроена + это ТГ).
  allowGroup?: boolean;
  groupTitle?: string | null;
};

// Диалог выбора получателей дайджеста: «Я» (предвыбран) + участники проекта.
export function RecipientPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  members,
  busy,
  onSend,
  allowGroup = false,
  groupTitle,
}: Props): React.ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set([SELF_KEY]));

  // При каждом открытии — сбрасываем выбор на «только я».
  useEffect(() => {
    if (open) setSelected(new Set([SELF_KEY]));
  }, [open]);

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const recipients: DigestRecipient[] = [...selected].map((key) =>
    key === SELF_KEY
      ? { kind: 'self' }
      : key === GROUP_KEY
        ? { kind: 'group' }
        : { kind: 'user', userId: key },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
          <Row checked={selected.has(SELF_KEY)} onToggle={() => toggle(SELF_KEY)} label="Я" hint="себе" />
          {allowGroup && (
            <Row
              checked={selected.has(GROUP_KEY)}
              onToggle={() => toggle(GROUP_KEY)}
              label={groupTitle?.trim() || 'Telegram-группа проекта'}
              hint="вся команда"
            />
          )}
          {(members ?? []).map((m) => (
            <Row
              key={m.id}
              checked={selected.has(m.id)}
              onToggle={() => toggle(m.id)}
              label={m.displayName}
              hint={m.email}
            />
          ))}
          {members !== null && members.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              В проекте нет других участников — можно отправить себе.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => onSend(recipients)} disabled={busy || recipients.length === 0}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Отправить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
}): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="truncate text-sm">{label}</span>
      <span className="ml-auto truncate text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}
