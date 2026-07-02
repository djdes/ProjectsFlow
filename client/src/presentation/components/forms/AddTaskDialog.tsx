import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, FileText, Inbox, Plus, X } from 'lucide-react';
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
import { AiComposeDialog } from '@/presentation/components/ai/AiComposeDialog';
import type { RichTextEditorHandle } from '@/presentation/components/editor/RichTextEditor';
import type { RalphMode, TaskPriority } from '@/domain/task/Task';

// Tiptap-редактор грузим лениво (тяжёлый chunk) — как в композере/окне задачи.
const RichTextEditor = lazy(() =>
  import('@/presentation/components/editor/RichTextEditor').then((m) => ({
    default: m.RichTextEditor,
  })),
);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PendingFile = { id: string; file: File; previewUrl: string };

// Sentinel для пункта «Без проекта» в radio-группе (radix требует строковое value).
const INBOX_VALUE = '__inbox__';

// Глобальное окно создания задачи (кнопка «Создать задачу» в левой панели). Как окно
// создания по проекту: Tiptap rich-редактор (форматирование по выделению, WYSIWYG,
// вставка картинок), плюсики «+ Подзадача»/«+ Файл», ряд icon-контролов (Приоритет,
// Дедлайн, Делегат), внизу — выбор проекта (Входящие/проект) + RalphMode + AI + Submit.
// Файлы — chips над редактором; drag&drop и Ctrl+V на форме кладут их в аттачи.
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
  // Tiptap-редактор: ref для «+ Подзадача» (вставка чек-пункта + фокус). Форма — для
  // программного submit по Ctrl/Cmd+Enter из редактора.
  const editorRef = useRef<RichTextEditorHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Inline-скрины: blob-URL превью в редакторе → File. Реальная загрузка отложена до
  // создания задачи (в handleSubmit blob-URL'ы заменяются на URL вложений). Как в TaskDrawer.
  const inlineImagesRef = useRef<Map<string, File>>(new Map());
  // autoFocus редактора — только на desktop (на мобильных клавиатура перекрывает диалог).
  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

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
      inlineImagesRef.current.forEach((_file, blobUrl) => URL.revokeObjectURL(blobUrl));
      inlineImagesRef.current.clear();
    }
  }, [open]);

  // При открытии этого окна закрываем inline-композер на доске (единая поверхность
  // создания — см. KanbanBoard). Слушатель — в KanbanBoard.
  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent('pf:close-inline-composer'));
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

  // Вставка картинки в текст (inline-блок): показываем сразу blob-превью, реальную загрузку
  // откладываем до создания задачи (см. handleSubmit). Задача ещё не существует.
  const uploadImageInline = async (
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<string | null> => {
    const blobUrl = URL.createObjectURL(file);
    inlineImagesRef.current.set(blobUrl, file);
    onProgress(100);
    return blobUrl;
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
        delegateUserId: delegateUserId ?? null,
        deadline,
        priority,
      });
      // Inline-скрины: грузим отложенные картинки и заменяем blob-URL на URL вложений.
      if (inlineImagesRef.current.size > 0) {
        let desc = trimmed;
        let changed = false;
        for (const [blobUrl, file] of inlineImagesRef.current) {
          if (desc.includes(blobUrl)) {
            try {
              const att = await taskRepository.uploadAttachment(targetId, task.id, file);
              desc = desc.split(blobUrl).join(att.url);
              changed = true;
            } catch (err) {
              toast.error(`Не удалось загрузить картинку: ${(err as Error).message}`);
            }
          }
          URL.revokeObjectURL(blobUrl);
        }
        inlineImagesRef.current.clear();
        if (changed) {
          try {
            await taskRepository.update(targetId, task.id, { description: desc });
          } catch (err) {
            toast.error(`Не удалось сохранить картинки в описании: ${(err as Error).message}`);
          }
        }
      }
      // Загружаем вложения (не-картинки + явно добавленные файлы) в созданную задачу.
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
      <DialogContent className="sm:max-w-2xl max-sm:flex max-sm:flex-col max-sm:overflow-y-hidden">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:gap-3 sm:space-y-3"
        >
          {/* На мобильных: scrollable-обёртка для textarea + pills, footer — за пределами скролла.
              На десктопе: sm:contents делает обёртку прозрачной, дети участвуют в space-y-3 формы. */}
          <div className="space-y-3 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto sm:contents">
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

            {/* Tiptap-редактор как в окне задачи: форматирование по выделению, WYSIWYG,
                вставка картинок. Ctrl/Cmd+Enter — submit формы. */}
            <Suspense fallback={<div className="min-h-[6rem]" />}>
              <RichTextEditor
                ref={editorRef}
                variant="description"
                selectionMenu={false}
                value={description}
                onChange={setDescription}
                onSubmit={() => {
                  if (!disabled) formRef.current?.requestSubmit();
                }}
                onPasteFiles={addFiles}
                onUploadImage={uploadImageInline}
                disabled={saving}
                autoFocus={!isCoarsePointer}
                placeholder="Что нужно сделать. Контекст, шаги, ссылки. Ctrl+V — скриншот вставится в текст."
                className="min-h-[6rem] text-sm leading-snug"
              />
            </Suspense>
          </div>

          {/* Плюсики: + Подзадача / + Файл — как в окне создания задачи по проекту. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => editorRef.current?.appendChecklistItem()}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <Plus className="size-4 shrink-0" />
              Подзадача
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <Plus className="size-4 shrink-0" />
              Файл
            </button>
          </div>

          {/* Ряд минималистичных icon-кнопок под полем ввода — мелкие size-8 ghost,
              как кластер действий в окне редактирования задачи. */}
          <div className="flex flex-wrap items-center gap-1">
            <PrioritySelect value={priority} onChange={setPriority} disabled={saving} iconOnly className="size-8" />
            <DeadlinePicker
              value={deadline}
              onChange={setDeadline}
              disabled={saving}
              iconOnly
              className={cn('h-8', deadline === null ? 'w-8 px-0' : 'px-2')}
            />
            {(projectId === null || (realProjects.find((p) => p.id === projectId)?.memberCount ?? 0) > 1) && (
              <DelegateSelect
                value={delegateUserId}
                onChange={setDelegateUserId}
                disabled={saving}
                projectId={projectId ?? undefined}
                className="size-8"
              />
            )}
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
          </div>{/* /scrollable wrapper */}

          {/* Footer: проект-чип слева, [RalphMode | Cancel | Submit] справа.
              На мобильных — flex-shrink-0 (не уезжает за скролл). */}
          <div className="max-sm:flex-shrink-0 flex flex-col gap-2 border-t pt-2 sm:pt-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Верхняя строка footer: проект + ralph + AI */}
            <div className="flex flex-wrap items-center gap-1.5 sm:contents">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    className="h-7 max-w-full gap-1 px-2 text-xs font-normal sm:h-8 sm:gap-1.5 sm:max-w-[50%]"
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
                    onValueChange={(v) => {
                      setProjectId(v === INBOX_VALUE ? null : v);
                      setDelegateUserId(null);
                    }}
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
              <RalphModeSelect
                value={ralphMode}
                onChange={setRalphMode}
                disabled={saving}
                variant="ghost"
                iconOnly
                className="!size-8 shrink-0 !p-0"
              />
              <AiComposeDialog
                text={description}
                projectId={projectId}
                onImproved={setDescription}
                onDistributed={() => onOpenChange(false)}
                ralphMode={ralphMode}
                disabled={saving}
                iconOnly
              />
            </div>

            {/* Нижняя строка footer: Cancel + Submit — компактные, как в окне задачи. */}
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs max-sm:hidden"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={disabled}>
                {saving ? 'Добавляем…' : 'Добавить'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
