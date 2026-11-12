import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import type {
  MemberTaskScope,
  ProjectSharing,
  WorkspaceTaskScope,
} from '@/domain/project/ProjectSharing';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import {
  MEMBER_SCOPE_LABEL,
  WORKSPACE_SCOPE_LABEL,
  connectedIds,
  draftFromView,
  toSaveInput,
  type WorkspaceAccessDraft,
} from './projectWorkspaceAccess';

const SELECT_CLASS =
  'h-9 min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

// Переключатели «из каких пространств» для правила «выбранные».
function WorkspaceChips({
  options,
  selected,
  disabled,
  onToggle,
}: {
  options: ReadonlyArray<{ id: string; name: string }>;
  selected: readonly string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}): React.ReactElement {
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">Подключите ещё пространство, чтобы выбрать.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = selected.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onToggle(option.id)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs',
              on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {option.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * «Доступ пространств» проекта (db/182): к каким пространствам подключён проект и кто чьи
 * задачи видит. Задача помнит пространство, где её создали; автор и ответственный видят свою
 * задачу всегда, руководители основного пространства — все задачи.
 */
export function ProjectWorkspaceAccessDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  onSaved?: () => void;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const [view, setView] = useState<ProjectSharing | null>(null);
  const [draft, setDraft] = useState<WorkspaceAccessDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setView(null);
    setDraft(null);
    projectRepository
      .getWorkspaceAccess(projectId)
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setDraft(draftFromView(next));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error((error as Error).message || 'Не удалось загрузить доступ пространств');
        onOpenChange(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, projectRepository, onOpenChange]);

  const canManage = view?.canManage ?? false;
  const connected = view && draft ? connectedIds(view, draft) : [];
  const nameOf = (id: string): string => view?.workspaces.find((w) => w.id === id)?.name ?? id;

  const setWorkspace = (id: string, patch: { connected?: boolean; scope?: WorkspaceTaskScope }): void => {
    setDraft((current) => {
      if (!current) return current;
      const prev = current.workspaces.get(id) ?? { connected: false, scope: { kind: 'own' } as WorkspaceTaskScope };
      return { ...current, workspaces: new Map(current.workspaces).set(id, { ...prev, ...patch }) };
    });
  };
  const setMember = (userId: string, rule: MemberTaskScope | null): void => {
    setDraft((current) => (current ? { ...current, members: new Map(current.members).set(userId, rule) } : current));
  };

  const save = async (): Promise<void> => {
    if (!view || !draft) return;
    setSaving(true);
    try {
      const next = await projectRepository.saveWorkspaceAccess(projectId, toSaveInput(view, draft));
      setView(next);
      setDraft(draftFromView(next));
      toast.success('Доступ пространств сохранён');
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось сохранить доступ пространств');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(44rem,92dvh)] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>Доступ пространств</DialogTitle>
          <DialogDescription>
            Проект «{projectName}» можно вести в&nbsp;нескольких пространствах. Задача помнит, где её
            создали, — по&nbsp;этому и&nbsp;настраивается, кто её видит.
          </DialogDescription>
        </DialogHeader>
        {!view || !draft ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Пространства</h3>
              <ul className="space-y-2">
                {view.workspaces.map((workspace) => {
                  const state = draft.workspaces.get(workspace.id) ?? { connected: false, scope: workspace.taskScope };
                  const on = workspace.isHome || state.connected;
                  const others = view.workspaces.filter((w) => w.id !== workspace.id && connected.includes(w.id));
                  return (
                    <li key={workspace.id} className="space-y-2 rounded-lg bg-panel px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Checkbox
                          checked={on}
                          disabled={!canManage || workspace.isHome || saving}
                          onCheckedChange={(value) => setWorkspace(workspace.id, { connected: value === true })}
                          aria-label={`Подключить пространство «${workspace.name}»`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {workspace.name}
                          {workspace.isHome && <span className="ms-2 text-xs font-normal text-muted-foreground">основное</span>}
                        </span>
                        {on && (
                          <select
                            className={SELECT_CLASS}
                            aria-label={`Какие задачи видит «${workspace.name}»`}
                            value={state.scope.kind}
                            disabled={!canManage || saving}
                            onChange={(event) => {
                              const kind = event.target.value as WorkspaceTaskScope['kind'];
                              setWorkspace(workspace.id, { scope: kind === 'selected' ? { kind, from: [] } : { kind } });
                            }}
                          >
                            {(Object.keys(WORKSPACE_SCOPE_LABEL) as Array<WorkspaceTaskScope['kind']>).map((kind) => (
                              <option key={kind} value={kind}>{WORKSPACE_SCOPE_LABEL[kind]}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      {on && state.scope.kind === 'selected' && (
                        <WorkspaceChips
                          options={others}
                          selected={state.scope.from}
                          disabled={!canManage || saving}
                          onToggle={(id) => {
                            const from = state.scope.kind === 'selected' ? state.scope.from : [];
                            setWorkspace(workspace.id, {
                              scope: { kind: 'selected', from: from.includes(id) ? from.filter((x) => x !== id) : [...from, id] },
                            });
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                Автор и&nbsp;ответственный всегда видят свою задачу, руководители основного пространства —
                все задачи. Подключить можно пространство, где вы владелец или руководитель.
              </p>
            </section>

            <details className="rounded-lg bg-panel px-3 py-2">
              <summary className="cursor-pointer select-none text-sm font-semibold">Правила для людей</summary>
              <ul className="mbs-2 space-y-2">
                {view.members.map((member) => {
                  const rule = draft.members.get(member.userId) ?? null;
                  const kind = rule?.kind ?? 'workspace';
                  return (
                    <li key={member.userId} className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {member.displayName}
                          <span className="ms-2 text-xs text-muted-foreground">
                            {member.workspaceIds.map(nameOf).join(', ')}
                          </span>
                        </span>
                        <select
                          className={SELECT_CLASS}
                          aria-label={`Какие задачи видит ${member.displayName}`}
                          value={kind}
                          disabled={!canManage || saving}
                          onChange={(event) => {
                            const next = event.target.value as MemberTaskScope['kind'] | 'workspace';
                            setMember(member.userId, next === 'workspace' ? null : next === 'selected' ? { kind: next, from: [] } : { kind: next });
                          }}
                        >
                          {(Object.keys(MEMBER_SCOPE_LABEL) as Array<keyof typeof MEMBER_SCOPE_LABEL>).map((value) => (
                            <option key={value} value={value}>{MEMBER_SCOPE_LABEL[value]}</option>
                          ))}
                        </select>
                      </div>
                      {rule?.kind === 'selected' && (
                        <WorkspaceChips
                          options={view.workspaces.filter((w) => connected.includes(w.id))}
                          selected={rule.from}
                          disabled={!canManage || saving}
                          onToggle={(id) =>
                            setMember(member.userId, {
                              kind: 'selected',
                              from: rule.from.includes(id) ? rule.from.filter((x) => x !== id) : [...rule.from, id],
                            })
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {canManage ? 'Отмена' : 'Закрыть'}
          </Button>
          {canManage && (
            <Button type="button" disabled={saving || !draft} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 motion-safe:animate-spin" /> : null}
              Сохранить
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
