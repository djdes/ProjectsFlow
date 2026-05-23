import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileText, Inbox, Paperclip, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useProjects } from '@/presentation/hooks/useProjects';
import {
  extractClipboardFiles,
  formatBytes,
  isImageMime,
} from '@/presentation/components/attachments/files';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PendingFile = { id: string; file: File; previewUrl: string };

// Sentinel для пункта «Без проекта» в radio-группе (radix требует строковое value).
const INBOX_VALUE = '__inbox__';

export function AddTaskDialog({ open, onOpenChange }: Props): React.ReactElement {
  const navigate = useNavigate();
  const { taskRepository, projectRepository } = useContainer();
  const { data: projects } = useProjects();
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // autoFocus только на desktop — на мобильных клавиатура сразу перекрывает диалог.
  const descRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el && !window.matchMedia('(pointer: coarse)').matches) el.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      setDescription('');
      setProjectId(null);
      setError(null);
      setPending((prev) => {
        prev.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        return [];
      });
    }
  }, [open]);

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
      prev.filter((p) => p.id === id).forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      return prev.filter((p) => p.id !== id);
    });
  };
  const handlePaste = (e: ClipboardEvent<HTMLFormElement>): void => {
    const files = extractClipboardFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
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
      const task = await taskRepository.create(targetId, { description: trimmed, status: 'backlog' });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-desc">
              Описание <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="task-desc"
              ref={descRef}
              rows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что нужно сделать. Контекст, шаги, ссылки."
              className="block w-full resize-none rounded-md border bg-background p-2 text-sm leading-snug placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <Label>Проект</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className="flex items-center gap-2 truncate">
                    {projectId === null && <Inbox className="size-4 shrink-0 text-muted-foreground" />}
                    {selectedName}
                  </span>
                  <ChevronDown className="size-4 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
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
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Файлы</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-3.5" />
                Прикрепить
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
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pending.map((pf) => (
                  <span
                    key={pf.id}
                    className="inline-flex items-center gap-1 rounded border bg-muted/60 py-0.5 pl-1.5 pr-1 text-[11px]"
                  >
                    {pf.previewUrl ? (
                      <img src={pf.previewUrl} alt="" className="size-4 rounded object-cover" />
                    ) : (
                      <FileText className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="max-w-[140px] truncate">{pf.file.name}</span>
                    <span className="text-muted-foreground">{formatBytes(pf.file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(pf.id)}
                      className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive hover:text-white"
                      aria-label="Убрать"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Любой тип файла. Можно вставить из&nbsp;буфера (Ctrl+V).
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              {saving ? 'Добавляем…' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
