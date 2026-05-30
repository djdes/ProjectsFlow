import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import {
  NOTIF_EVENT_LABELS,
  resolvePref,
  type NotificationPrefs,
  type NotifEventType,
  type NotifSource,
} from '@/domain/notifications/NotificationPrefs';

export function NotificationDefaultsCard(): React.ReactElement {
  const { userRepository } = useContainer();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    userRepository
      .getDefaultNotificationPrefs()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => {
        if (!cancelled) setPrefs({});
      });
    return () => {
      cancelled = true;
    };
  }, [userRepository]);

  const toggle = useCallback(
    (type: NotifEventType, source: NotifSource, value: boolean) => {
      setPrefs((prev) => {
        const base = prev ?? {};
        const current = base[type] ?? {
          team: resolvePref(base, type, 'team'),
          mcp: resolvePref(base, type, 'mcp'),
        };
        const nextEntry = { ...current, [source]: value };
        const next: NotificationPrefs = { ...base, [type]: nextEntry };
        userRepository.setDefaultNotificationPrefs(next).catch(() => {
          setPrefs(prev);
          toast.error('Не удалось сохранить настройку');
        });
        return next;
      });
    },
    [userRepository],
  );

  const applyAll = async (): Promise<void> => {
    setApplying(true);
    try {
      const applied = await userRepository.applyDefaultNotificationPrefsToAll();
      toast.success(`Настройки применены к ${applied} проектам`);
    } catch {
      toast.error('Не удалось применить настройки');
    } finally {
      setApplying(false);
    }
  };

  const loading = prefs === null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="size-5 text-primary" />
          <CardTitle>Email-уведомления по умолчанию</CardTitle>
        </div>
        <CardDescription>
          Эти настройки автоматически применяются при вступлении в новый проект.
          Также можно применить их ко всем текущим проектам.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:gap-x-4">
            <span>Событие</span>
            <span className="w-10 text-center sm:w-12">Команда</span>
            <span className="w-10 text-center sm:w-12">MCP</span>
          </div>
          {NOTIF_EVENT_LABELS.map(({ type, label }) => (
            <div
              key={type}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 px-3 py-2 text-sm sm:gap-x-4"
            >
              <span className="truncate">{label}</span>
              <span className="flex w-10 justify-center sm:w-12">
                <Switch
                  checked={resolvePref(prefs, type, 'team')}
                  onCheckedChange={(v) => toggle(type, 'team', v)}
                  disabled={loading}
                  aria-label={`${label}: от команды`}
                />
              </span>
              <span className="flex w-10 justify-center sm:w-12">
                <Switch
                  checked={resolvePref(prefs, type, 'mcp')}
                  onCheckedChange={(v) => toggle(type, 'mcp', v)}
                  disabled={loading}
                  aria-label={`${label}: от MCP`}
                />
              </span>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void applyAll()}
          disabled={loading || applying}
        >
          {applying ? 'Применяем…' : 'Применить ко всем текущим проектам'}
        </Button>
      </CardContent>
    </Card>
  );
}
