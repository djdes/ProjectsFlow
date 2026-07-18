import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import type {
  ProjectCodeFile,
  ProjectCodeTree,
  ProjectCodeTreeEntry,
} from "@/application/project-code/ProjectCodeRepository";
import { Button } from "@/components/ui/button";
import { useContainer } from "@/infrastructure/di/container";
import { HttpError } from "@/lib/HttpError";
import { cn } from "@/lib/utils";

type Props = {
  readonly projectId: string;
  readonly repoUrl: string;
  readonly canEdit: boolean;
};

const restrictionLabels = {
  sensitive: "Секретный файл скрыт",
  binary: "Бинарный файл нельзя редактировать",
  too_large: "Файл слишком большой для редактора",
} as const;

export function RepositoryCodeEditor({
  projectId,
  repoUrl,
  canEdit,
}: Props): React.ReactElement {
  const { projectCodeRepository } = useContainer();
  const [tree, setTree] = useState<ProjectCodeTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [file, setFile] = useState<ProjectCodeFile | null>(null);
  const [content, setContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const dirty = file !== null && content !== file.content;

  const loadTree = useCallback(async (): Promise<void> => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const result = await projectCodeRepository.getTree(projectId);
      setTree(result);
      setExpanded(
        new Set(
          result.entries
            .filter(
              (entry) => entry.type === "dir" && !entry.path.includes("/"),
            )
            .map((entry) => entry.path),
        ),
      );
    } catch (error) {
      setTreeError(
        errorMessage(error, "Не удалось загрузить дерево репозитория."),
      );
    } finally {
      setTreeLoading(false);
    }
  }, [projectCodeRepository, projectId]);

  useEffect(() => {
    setTree(null);
    setFile(null);
    setContent("");
    setCommitMessage("");
    void loadTree();
  }, [loadTree]);

  const visibleEntries = useMemo(
    () =>
      (tree?.entries ?? []).filter((entry) =>
        ancestorsExpanded(entry.path, expanded),
      ),
    [expanded, tree?.entries],
  );

  const openFile = async (
    entry: ProjectCodeTreeEntry,
    force = false,
  ): Promise<void> => {
    if (entry.type !== "file") return;
    if (entry.restricted && entry.restrictedReason) {
      toast.info(restrictionLabels[entry.restrictedReason]);
      return;
    }
    if (
      !force &&
      file?.path !== entry.path &&
      dirty &&
      !window.confirm(
        "Есть несохранённые изменения. Открыть другой файл без сохранения?",
      )
    )
      return;
    setFileLoading(true);
    setFileError(null);
    try {
      const loaded = await projectCodeRepository.getFile(projectId, entry.path);
      setFile(loaded);
      setContent(loaded.content);
      setCommitMessage("");
    } catch (error) {
      setFileError(errorMessage(error, "Не удалось открыть файл."));
    } finally {
      setFileLoading(false);
    }
  };

  const reloadFile = async (): Promise<void> => {
    if (!file) return;
    if (
      dirty &&
      !window.confirm(
        "Отменить несохранённые изменения и загрузить версию из GitHub?",
      )
    )
      return;
    const entry = tree?.entries.find((item) => item.path === file.path);
    if (entry) await openFile(entry, true);
  };

  const saveFile = async (): Promise<void> => {
    if (!file || !dirty || !canEdit || saving) return;
    setSaving(true);
    setFileError(null);
    try {
      const result = await projectCodeRepository.saveFile(projectId, {
        path: file.path,
        sha: file.sha,
        content,
        ...(commitMessage.trim() ? { message: commitMessage.trim() } : {}),
      });
      setFile({
        ...file,
        content,
        sha: result.sha,
        size: new TextEncoder().encode(content).length,
      });
      setCommitMessage("");
      setTree((current) =>
        current
          ? {
              ...current,
              entries: current.entries.map((entry) =>
                entry.path === file.path
                  ? { ...entry, sha: result.sha }
                  : entry,
              ),
            }
          : current,
      );
      toast.success("Файл сохранён и отправлен в GitHub");
    } catch (error) {
      const message =
        error instanceof HttpError && error.status === 409
          ? "Файл уже изменился в GitHub. Перезагрузите его и повторите правку."
          : errorMessage(error, "Не удалось сохранить файл.");
      setFileError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleDirectory = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-muted/15 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {tree?.fullName ?? "GitHub repository"}
          </p>
          <p className="text-xs text-muted-foreground">
            Текстовые файлы · сохранение создаёт commit в подключённом
            репозитории
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void loadTree()}
            disabled={treeLoading}
            aria-label="Обновить дерево"
          >
            <RefreshCw
              className={cn("size-3.5", treeLoading && "animate-spin")}
            />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Открыть репозиторий в GitHub"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
      {tree?.truncated && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="size-3.5" />
          GitHub вернул неполное дерево очень большого репозитория.
        </div>
      )}
      <div className="grid min-h-[560px] lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside
          className="max-h-[680px] overflow-auto border-b bg-muted/5 p-2 lg:border-b-0 lg:border-r"
          aria-label="Файлы репозитория"
        >
          {treeLoading && (
            <StateMessage
              icon={<Loader2 className="size-4 animate-spin" />}
              text="Загружаем файлы…"
            />
          )}
          {!treeLoading && treeError && (
            <StateMessage
              icon={<AlertTriangle className="size-4 text-destructive" />}
              text={treeError}
            />
          )}
          {!treeLoading &&
            !treeError &&
            visibleEntries.map((entry) => {
              const depth = entry.path.split("/").length - 1;
              const open = expanded.has(entry.path);
              return (
                <button
                  key={`${entry.type}:${entry.path}`}
                  type="button"
                  onClick={() =>
                    entry.type === "dir"
                      ? toggleDirectory(entry.path)
                      : void openFile(entry)
                  }
                  title={entry.path}
                  className={cn(
                    "flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs hover:bg-muted/70",
                    file?.path === entry.path && "bg-muted font-medium",
                  )}
                  style={{ paddingLeft: 8 + depth * 14 }}
                >
                  {entry.type === "dir" ? (
                    <>
                      <ChevronRight
                        className={cn(
                          "size-3 transition-transform",
                          open && "rotate-90",
                        )}
                      />
                      {open ? (
                        <FolderOpen className="size-3.5 text-amber-500" />
                      ) : (
                        <Folder className="size-3.5 text-amber-500" />
                      )}
                    </>
                  ) : (
                    <>
                      <span className="w-3" />
                      {entry.restricted ? (
                        <LockKeyhole className="size-3.5 text-muted-foreground" />
                      ) : (
                        <FileCode2 className="size-3.5 text-muted-foreground" />
                      )}
                    </>
                  )}
                  <span className="truncate">
                    {entry.path.split("/").at(-1)}
                  </span>
                </button>
              );
            })}
          {!treeLoading && !treeError && tree?.entries.length === 0 && (
            <StateMessage text="Репозиторий пуст." />
          )}
        </aside>
        <section className="flex min-w-0 flex-col bg-zinc-950 text-zinc-100">
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-zinc-200">
                {file?.path ?? "Выберите файл слева"}
              </p>
              {file && (
                <p className="truncate font-mono text-[10px] text-zinc-500">
                  sha {file.sha.slice(0, 12)} ·{" "}
                  {file.size.toLocaleString("ru-RU")} Б
                </p>
              )}
            </div>
            {dirty && (
              <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[10px] font-medium text-amber-300">
                не сохранено
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-zinc-300 hover:bg-white/10 hover:text-white"
              onClick={() => void reloadFile()}
              disabled={!file || fileLoading || saving}
              aria-label="Перезагрузить файл"
            >
              <RefreshCw
                className={cn("size-3.5", fileLoading && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              onClick={() => void saveFile()}
              disabled={!canEdit || !dirty || saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Сохранить
            </Button>
          </div>
          {fileError && (
            <div className="border-b border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {fileError}
            </div>
          )}
          <div className="relative min-h-0 flex-1">
            {fileLoading && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-zinc-950/70">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}
            {file ? (
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === "s"
                  ) {
                    event.preventDefault();
                    void saveFile();
                  }
                }}
                readOnly={!canEdit}
                spellCheck={false}
                aria-label={`Редактор ${file.path}`}
                className="min-h-[500px] w-full resize-none bg-transparent p-4 font-mono text-xs leading-6 text-zinc-100 outline-none"
              />
            ) : (
              <div className="grid min-h-[500px] place-items-center px-6 text-center text-sm text-zinc-500">
                Выберите текстовый файл в дереве репозитория.
                <br />
                Секреты, бинарные и слишком большие файлы защищены сервером.
              </div>
            )}
          </div>
          {file && (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 p-3">
              <input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                maxLength={240}
                disabled={!canEdit || saving}
                placeholder={`Сообщение коммита (необязательно)`}
                className="h-9 min-w-[240px] flex-1 rounded-md border border-white/10 bg-white/5 px-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-blue-400"
              />
              <span className="text-[10px] text-zinc-500">Ctrl/⌘ + S</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ancestorsExpanded(
  path: string,
  expanded: ReadonlySet<string>,
): boolean {
  const parts = path.split("/");
  if (parts.length <= 1) return true;
  let parent = "";
  for (let index = 0; index < parts.length - 1; index += 1) {
    parent = parent ? `${parent}/${parts[index]}` : parts[index]!;
    if (!expanded.has(parent)) return false;
  }
  return true;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function StateMessage({
  icon,
  text,
}: {
  readonly icon?: ReactNode;
  readonly text: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
      {icon}
      {text}
    </div>
  );
}
