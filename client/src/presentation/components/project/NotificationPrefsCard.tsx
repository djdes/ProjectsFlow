import { Switch } from '@/components/ui/switch';
import { useNotificationPrefs } from '@/presentation/hooks/useNotificationPrefs';
import { NOTIF_EVENT_LABELS, resolvePref } from '@/domain/notifications/NotificationPrefs';

// «Мои уведомления» по проекту: для каждого типа события — два переключателя
// (от команды / от MCP). Каждый участник управляет только своими настройками.
export function NotificationPrefsCard({ projectId }: { projectId: string }): React.ReactElement {
  const { prefs, loading, toggle } = useNotificationPrefs(projectId);

  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Мои уведомления</p>
      <p className="text-xs text-muted-foreground">
        Письма на почту при действиях в проекте. «От MCP» — действия агента (по умолчанию выкл).
      </p>

      <div className="rounded-md border">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:gap-x-4">
          <span>Событие</span>
          <span className="w-12 text-center">Команда</span>
          <span className="w-12 text-center">MCP</span>
        </div>
        {NOTIF_EVENT_LABELS.map(({ type, label }) => (
          <div
            key={type}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 px-3 py-2 text-sm sm:gap-x-4"
          >
            <span className="truncate">{label}</span>
            <span className="flex w-12 justify-center">
              <Switch
                checked={resolvePref(prefs, type, 'team')}
                onCheckedChange={(v) => toggle(type, 'team', v)}
                disabled={loading}
                aria-label={`${label}: от команды`}
              />
            </span>
            <span className="flex w-12 justify-center">
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
    </div>
  );
}
