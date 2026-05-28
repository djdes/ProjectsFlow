import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileText, Inbox, Paperclip, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';
import {
  extractClipboardFiles,
  isImageMime,
} from '@/presentation/components/attachments/files';
import { RalphModeSelect } from '@/presentation/components/tasks/RalphMode';
import { DelegateSelect } from '@/presentation/components/tasks/DelegateSelect';
import { DeadlinePicker } from '@/presentation/components/tasks/DeadlinePicker';
import { PrioritySelect } from '@/presentation/components/tasks/PrioritySelect';
import type { RalphMode, TaskPriority } from '@/domain/task/Task';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PendingFile = { id: string; file: File; previewUrl: string };

// Sentinel для пункта «Без проекта» в radio-группе (radix требует строковое value).
const INBOX_VALUE = '__inbox__';

// Компактный Todoist-style диалог: textarea сверху, ряд пилюль-кнопок снизу
// (Приоритет, Дедлайн, Делегировать, RalphMode, Вложение), внизу — проект-чип
// + Cancel/Submit. Файлы — chips НАД textarea (как в QuickAddTodo). Drag&drop
// и Ctrl+V работают на самом текстовом поле.
export function AddTaskDialog({ open, onOpenChange }: Props): React.ReactElement {
  const navigate = useNavigate();
  const { taskRepository, projectRepository } = useContainer();
  const { data: projects } = useProjects();
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [ralphMode, setRalphMode] = useState<RalphMode>('normal');
  // Делегат для inbox-задачи. Сбрасывается при смене проекта на «не-inbox».
  const [delegateUserId, setDelegateUserId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // autoFocus только на desktop — на мобильных клавиатура сразу перекрывает диалог.
  const descRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el && !window.matchMedia('(pointer: coarse)').matches) el.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      setDescription('');
      setProjectId(null);
      setRalphMode('normal');
      setDelegateUserId(null);
      setDeadline(null);
      setPriority(null);
      setError(null);
      setDragActive(false);
      setPending((prev) => {
        prev.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        return [];
      });
    }
  }, [open]);

  // При смене проекта на «не-inbox» сбрасываем делегата — он применим только к inbox.
  useEffect(() => {
    if (projectId !== null) setDelegateUserId(null);
  }, [projectId]);

  const addFiles = (raw: FileList | File[]): void => {
    const list = Array.from(raw);
    if (list.length === 0) return;
    setPending((prev) => [
      ...prev,
      ...list.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : '',
      })),
    ]);
  };

  const removeFile = (id: string): void => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handlePaste = (e: ClipboardEvent<HTMLFormElement>): void => {
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const handleDragOver = (e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setDragActive(false);
  };
  const handleDrop = (e: DragEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // Только реальные проекты — inbox выбирается пунктом «Без проекта».
  const realProjects = (projects ?? []).filter((p) => !p.isInbox);
  const selectedName =
    projectId === null
      ? 'Без проекта (Входящие)'
      : (realProjects.find((p) => p.id === projectId)?.name ?? 'Без проекта (Входящие)');

  const trimmed = description.trim();
  const disabled = saving || trimmed.length === 0;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (disabled) return;
    setSaving(true);
    setError(null);
    try {
      // По умолчанию (без проекта) — во «Входящие»; иначе в выбранный проект.
      const targetId = projectId ?? (await projectRepository.getInbox()).id;
      const task = await taskRepository.create(targetId, {
        description: trimmed,
        status: 'backlog',
        ralphMode,
        // delegateUserId применим только когда projectId === null (inbox).
        delegateUserId: projectId === null ? delegateUserId : null,
        deadline,
        priority,
      });
      // Загружаем вложения в созданную задачу (best-effort, ошибки — toast'ом).
      for (const pf of pending) {
        try {
          await taskRepository.uploadAttachment(targetId, task.id, pf.file);
        } catch (err) {
          toast.error(`Не удалось загрузить ${pf.file.name}: ${(err as Error).message}`);
        }
      }
      onOpenChange(false);
      toast.success(
        projectId === null ? 'Задача добавлена во «Входящие»' : 'Задача добавлена в проект',
      );
      navigate(projectId === null ? '/inbox' : `/projects/${projectId}`);
    } catch (err) {
      setError(`Не удалось добавить задачу: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="space-y-3"
        >
          {/* Drag overlay indicator. Не блокирует ввод — просто рамку подсветит. */}
          <div
            className={cn(
              'relative space-y-2 rounded-md border bg-background px-2 py-2 transition-colors',
              dragActive ? 'border-primary bg-primary/5' : 'border-input',
            )}
          >
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pending.map((pf) => (
                  <span
                    key={pf.id}
                    className="inline-flex items-center gap-1.5 rounded border bg-background py-0.5 pl-1.5 pr-1 text-[11px]"
                    title={pf.file.name}
                  >
                    {pf.previewUrl ? (
                      <img src={pf.previewUrl} alt="" className="size-4 rounded object-cover" />
                    ) : (
                      <FileText className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="max-w-[160px] truncate">{pf.file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(pf.id)}
                      className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-white"
                      aria-label="Убрать"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <textarea
              id="task-desc"
              ref={descRef}
              rows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что нужно сделать. Контекст, шаги, ссылки. Ctrl+V — картинка пойдёт в аттачи."
              className="block w-full resize-none bg-transparent text-sm leading-snug placeholder:text-muted-foreground/70 focus:outline-none"
            />
          </div>

          {/* Ряд пилюль-кнопок под полем ввода. Все в одну строку (flex-wrap fallback
              на узких экранах). RalphMode сюда не входит — он в footer-е слева от Cancel. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <PrioritySelect value={priority} onChange={setPriority} disabled={saving} compact />
            <DeadlinePicker value={deadline} onChange={setDeadline} disabled={saving} />
            {projectId === null && (
              <DelegateSelect
                value={delegateUserId}
                onChange={setDelegateUserId}
                disabled={saving}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              title="Вложение (или перетащи файл / Ctrl+V)"
            >
              <Paperclip className="size-3.5" />
              Вложение
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Footer: проект-чип слева, [RalphMode | Cancel | Submit] справа. */}
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  className="h-8 max-w-[50%] gap-1.5 px-2 text-xs font-normal"
                >
                  <Inbox className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{selectedName}</span>
                  <ChevronDown className="size-3 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-72 min-w-[260px] overflow-y-auto"
              >
                <DropdownMenuRadioGroup
                  value={projectId ?? INBOX_VALUE}
                  onValueChange={(v) => setProjectId(v === INBOX_VALUE ? null : v)}
                >
                  <DropdownMenuRadioItem value={INBOX_VALUE}>
                    Без проекта (Входящие)
                  </DropdownMenuRadioItem>
                  {realProjects.map((p) => (
                    <DropdownMenuRadioItem key={p.id} value={p.id}>
                      {p.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-2">
              <RalphModeSelect
                value={ralphMode}
                onChange={setRalphMode}
                disabled={saving}
                className="!h-8 min-w-[140px] !px-2 text-xs"
              />
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={disabled}>
                {saving ? 'Добавляем…' : 'Добавить'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
