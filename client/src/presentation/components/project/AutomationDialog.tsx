import { useEffect, useState, type FormEvent } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type {
  AutomationConfig,
  AutomationLimitKind,
} from '@/domain/automation/AutomationConfig';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  // У проекта назначен диспетчер? Без него автоматизация не «оживёт» (некому выполнять).
  hasDispatcher: boolean;
};

type DraftCriterion = {
  key: string;
  label: string;
  enabled: boolean;
  systemPrompt: string;
  userHint: string;
};

type Draft = {
  enabled: boolean;
  limitKind: AutomationLimitKind;
  limitCount: number;
  limitMinutes: number;
  pauseMinMinutes: number;
  pauseMaxMinutes: number;
  criteria: DraftCriterion[];
};

const RUN_STATUS_LABEL: Record<AutomationConfig['runStatus'], string> = {
  idle: 'не запускалась',
  running: 'идёт',
  completed: 'лимит достигнут',
  stopped: 'остановлена',
};

function toDraft(config: AutomationConfig): Draft {
  return {
    enabled: config.enabled,
    limitKind: config.limitKind,
    limitCount: config.limitCount ?? 5,
    limitMinutes: config.limitMinutes ?? 60,
    pauseMinMinutes: Math.max(1, Math.round(config.pauseMinSeconds / 60)),
    pauseMaxMinutes: Math.max(1, Math.round(config.pauseMaxSeconds / 60)),
    criteria: config.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      enabled: c.enabled,
      systemPrompt: c.systemPrompt,
      userHint: c.userHint ?? '',
    })),
  };
}

// Диалог настроек автоматизации. Сайт хранит конфиг + редактируемые промпты; диспетчер
// (ralph) сам генерирует и выполняет задачи, когда у проекта нет открытых задач.
export function AutomationDialog({
  open,
  onOpenChange,
  projectId,
  hasDispatcher,
}: Props): React.ReactElement {
  const { automationRepository } = useContainer();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [runInfo, setRunInfo] = useState<Pick<
    AutomationConfig,
    'runStatus' | 'tasksCreated'
  > | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    automationRepository
      .get(projectId)
      .then((config) => {
        if (cancelled) return;
        setDraft(toDraft(config));
        setRunInfo({ runStatus: config.runStatus, tasksCreated: config.tasksCreated });
      })
      .catch((e) => {
        if (!cancelled) setError(`Не удалось загрузить настройки: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, automationRepository]);

  const update = (patch: Partial<Draft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateCriterion = (key: string, patch: Partial<DraftCriterion>): void => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            criteria: prev.criteria.map((c) => (c.key === key ? { ...c, ...patch } : c)),
          }
        : prev,
    );
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!draft) return;

    // Валидация перед сохранением.
    if (draft.pauseMaxMinutes < draft.pauseMinMinutes) {
      setError('Максимальная пауза не может быть меньше минимальной');
      return;
    }
    if (draft.enabled && !draft.criteria.some((c) => c.enabled)) {
      setError('Выберите хотя бы один критерий');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await automationRepository.save(projectId, {
        enabled: draft.enabled,
        limitKind: draft.limitKind,
        limitCount: draft.limitKind === 'count' ? draft.limitCount : null,
        limitMinutes: draft.limitKind === 'time' ? draft.limitMinutes : null,
        pauseMinSeconds: draft.pauseMinMinutes * 60,
        pauseMaxSeconds: draft.pauseMaxMinutes * 60,
        ralphMode: 'silent',
        criteria: draft.criteria.map((c) => ({
          key: c.key,
          enabled: c.enabled,
          systemPrompt: c.systemPrompt,
          userHint: c.userHint.trim().length > 0 ? c.userHint : null,
        })),
      });
      setRunInfo({ runStatus: updated.runStatus, tasksCreated: updated.tasksCreated });
      onOpenChange(false);
      toast.success(
        draft.enabled ? 'Автоматизация включена' : 'Настройки автоматизации сохранены',
      );
    } catch (err) {
      setError(`Не удалось сохранить: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Автоматизация проекта
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Когда у проекта нет открытых задач, диспетчер сам генерирует новые задачи по выбранным
          критериям и выполняет их в тихом режиме — с паузами между задачами, по кругу, пока не
          достигнут лимит.
        </p>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Загрузка…
          </div>
        ) : !draft ? (
          <p className="py-6 text-sm text-destructive">{error ?? 'Нет данных'}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Мастер-переключатель */}
            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <div>
                <Label className="text-sm font-medium">Включить автоматизацию</Label>
                <p className="text-xs text-muted-foreground">
                  Диспетчер начнёт работать на этом проекте.
                </p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => update({ enabled: v })}
                aria-label="Включить автоматизацию"
              />
            </div>

            {!hasDispatcher && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                У проекта не назначен диспетчер. Автоматизация сохранится, но задачи начнут
                создаваться и выполняться только после назначения диспетчера в «Настройках».
              </p>
            )}

            {/* Критерии */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Критерии задач
              </p>
              <div className="space-y-2">
                {draft.criteria.map((c) => (
                  <div key={c.key} className="rounded-md border">
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                      <Checkbox
                        checked={c.enabled}
                        onCheckedChange={(v) => updateCriterion(c.key, { enabled: v === true })}
                      />
                      <span className="text-sm">{c.label}</span>
                    </label>
                    {c.enabled && (
                      <div className="space-y-2 border-t px-3 py-2.5">
                        <div className="space-y-1">
                          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Системный промпт
                          </Label>
                          <textarea
                            rows={4}
                            value={c.systemPrompt}
                            maxLength={8000}
                            onChange={(e) =>
                              updateCriterion(c.key, { systemPrompt: e.target.value })
                            }
                            className="block w-full resize-y rounded-md border bg-transparent px-2 py-1.5 text-xs leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Уточнение (что именно хотите)
                          </Label>
                          <textarea
                            rows={2}
                            value={c.userHint}
                            maxLength={2000}
                            placeholder="Напр. фичи лендинга: чат, фильтрации, маркетинг"
                            onChange={(e) => updateCriterion(c.key, { userHint: e.target.value })}
                            className="block w-full resize-y rounded-md border bg-transparent px-2 py-1.5 text-xs leading-snug placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Лимит */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Лимит
              </p>
              <RadioGroup
                value={draft.limitKind}
                onValueChange={(v) => update({ limitKind: v as AutomationLimitKind })}
                className="gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="count" id="limit-count" />
                  <Label htmlFor="limit-count" className="text-sm font-normal">
                    По количеству задач
                  </Label>
                  {draft.limitKind === 'count' && (
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={draft.limitCount}
                      onChange={(e) =>
                        update({ limitCount: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="ml-auto h-8 w-24"
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="time" id="limit-time" />
                  <Label htmlFor="limit-time" className="text-sm font-normal">
                    По времени (минут от первой задачи)
                  </Label>
                  {draft.limitKind === 'time' && (
                    <Input
                      type="number"
                      min={1}
                      max={100000}
                      value={draft.limitMinutes}
                      onChange={(e) =>
                        update({ limitMinutes: Math.max(1, Number(e.target.value) || 1) })
                      }
                      className="ml-auto h-8 w-24"
                    />
                  )}
                </div>
              </RadioGroup>
            </div>

            {/* Паузы */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Пауза между задачами (эмуляция человека)
              </p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">от</span>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={draft.pauseMinMinutes}
                  onChange={(e) =>
                    update({ pauseMinMinutes: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="h-8 w-20"
                />
                <span className="text-muted-foreground">до</span>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={draft.pauseMaxMinutes}
                  onChange={(e) =>
                    update({ pauseMaxMinutes: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className="h-8 w-20"
                />
                <span className="text-muted-foreground">мин</span>
              </div>
            </div>

            {/* Прогресс */}
            {runInfo && runInfo.runStatus !== 'idle' && (
              <p className="text-xs text-muted-foreground">
                Прогресс: создано задач — {runInfo.tasksCreated}; статус —{' '}
                {RUN_STATUS_LABEL[runInfo.runStatus]}.
              </p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
