import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ExternalLink, FolderGit2, GitCommitHorizontal, Loader2, Pencil, Search, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from '@/components/ui/sonner';
import type { AdminProject } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { getInitials } from '@/presentation/layout/projectIcons';
import { ADMIN_LIST_CLASS, AdminEmpty, AdminError, AdminLoading, errorText } from './AdminState';
import { pluralRu } from './mailing/mailingFormat';

// Статус проекта приходит кодом ('active' …) — в интерфейсе показываем по-русски.
const PROJECT_STATUS_LABEL: Record<AdminProject['status'], string> = {
  active: 'активен',
  paused: 'на паузе',
  archived: 'в архиве',
};

// «Проекты»: все проекты платформы, сгруппированные по владельцу, с поиском и правкой git-репо.
export function AdminProjectsTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [projects, setProjects] = useState<AdminProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback((): void => {
    setError(null);
    adminRepository.listProjects().then(setProjects).catch((e: unknown) => setError(errorText(e, 'Не удалось загрузить проекты')));
  }, [adminRepository]);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, { owner: string; email: string; items: AdminProject[] }>();
    for (const p of projects ?? []) {
      if (needle && ![p.name, p.ownerDisplayName, p.ownerEmail, p.gitRepoUrl ?? ''].some((v) => v.toLowerCase().includes(needle))) continue;
      const g = map.get(p.ownerId) ?? { owner: p.ownerDisplayName, email: p.ownerEmail, items: [] };
      g.items.push(p);
      map.set(p.ownerId, g);
    }
    return [...map.entries()];
  }, [projects, query]);

  const replaceProject = (id: string, patch: Partial<AdminProject>): void => {
    setProjects((prev) => prev?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? prev);
  };

  if (error) return <AdminError message={error} onRetry={load} />;
  if (!projects) return <AdminLoading />;
  if (projects.length === 0) return <AdminEmpty icon={FolderGit2} title="Проектов пока нет" />;

  const shown = groups.reduce((n, [, g]) => n + g.items.length, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute start-2.5 inset-bs-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск проектов"
            placeholder="Проект, владелец или репозиторий" className="ps-8" />
        </div>
        <p className="text-meta tabular-nums text-muted-foreground" aria-live="polite">
          {shown} {pluralRu(shown, 'проект', 'проекта', 'проектов')}
        </p>
      </div>
      {groups.length === 0 && <AdminEmpty icon={Search} title="Ничего не найдено">Измените запрос поиска.</AdminEmpty>}
      {groups.map(([ownerId, g]) => (
        <section key={ownerId} className="space-y-1.5" aria-label={`Проекты: ${g.owner}`}>
          <h2 className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
            <Avatar className="size-5">
              <AvatarFallback className="text-[9px]">{getInitials(g.owner)}</AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-foreground">{g.owner}</span>
            <span className="truncate">{g.email}</span>
            <span className="ms-auto shrink-0 tabular-nums">{g.items.length}</span>
          </h2>
          <ul className={ADMIN_LIST_CLASS}>
            {g.items.map((p) => (
              <li key={p.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2 text-ui">
                    <Link to={`/projects/${p.id}`} className="truncate font-medium hover:underline focus-visible:underline">{p.name}</Link>
                    {p.status !== 'active' && (
                      <span className="pf-tag pf-tone-gray shrink-0 text-2xs">{PROJECT_STATUS_LABEL[p.status] ?? p.status}</span>
                    )}
                  </p>
                  <EditableProjectRepo projectId={p.id} currentUrl={p.gitRepoUrl}
                    onSaved={(newUrl) => replaceProject(p.id, { gitRepoUrl: newUrl })} />
                </div>
                <div className="flex items-center gap-3 text-meta tabular-nums text-muted-foreground">
                  <span className="inline-flex items-center gap-1" title="Участники"><Users className="size-3" /> {p.memberCount}</span>
                  <span className="inline-flex items-center gap-1" title="Задачи"><GitCommitHorizontal className="size-3" /> {p.taskCount}</span>
                  <Button asChild size="sm" variant="ghost" className="ms-auto sm:ms-0">
                    <Link to={`/projects/${p.id}/overview`}>Обзор</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Inline-редактирование gitRepoUrl проекта (admin-only). Пустая строка → null (отвязать);
// невалидный URL проверяет сервер и возвращает ошибку в toast.
function EditableProjectRepo({
  projectId,
  currentUrl,
  onSaved,
}: {
  projectId: string;
  currentUrl: string | null;
  onSaved: (newUrl: string | null) => void;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentUrl ?? '');
  const [saving, setSaving] = useState(false);

  const cancelEdit = (): void => {
    setEditing(false);
    setDraft(currentUrl ?? '');
  };
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const trimmed = draft.trim();
      const newUrl = trimmed.length === 0 ? null : trimmed;
      await projectRepository.update(projectId, { gitRepoUrl: newUrl });
      onSaved(newUrl);
      setEditing(false);
      toast.success(newUrl === null ? 'Git-репозиторий отвязан' : 'Git-репозиторий обновлён');
    } catch (e) {
      toast.error(errorText(e, 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="mbs-1 flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancelEdit();
          }}
          autoFocus
          disabled={saving}
          aria-label="Адрес git-репозитория"
          placeholder="https://github.com/owner/repo — пусто, чтобы отвязать"
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button variant="ghost" size="icon" className="size-7" disabled={saving} onClick={() => void save()} aria-label="Сохранить">
          {saving ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : <Check className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" disabled={saving} onClick={cancelEdit} aria-label="Отмена">
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
      <FolderGit2 className="size-3 shrink-0" />
      {currentUrl ? (
        <a href={currentUrl} target="_blank" rel="noreferrer noopener" title={currentUrl}
          className="inline-flex min-w-0 items-center gap-1 font-mono text-2xs hover:text-foreground hover:underline">
          <span className="truncate">{currentUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : (
        <span>репозиторий не подключён</span>
      )}
      <Button variant="ghost" size="icon" className="size-6 max-sm:size-8" onClick={() => { setDraft(currentUrl ?? ''); setEditing(true); }}
        aria-label="Изменить git-репозиторий" title="Изменить git-репозиторий">
        <Pencil className="size-3" />
      </Button>
    </div>
  );
}
