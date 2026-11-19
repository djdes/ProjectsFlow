import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/relativeTime';
import type { AdminSupportTicket } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { ADMIN_LIST_CLASS, AdminEmpty, AdminError, AdminLoading, errorText } from './AdminState';

type View = 'open' | 'closed' | 'all';

// «Поддержка»: обращения из приложения и с лендинга. Открытые — по умолчанию.
export function AdminSupportTab(): React.ReactElement {
  const { adminRepository } = useContainer();
  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View>('open');

  const load = useCallback((): void => {
    setError(null);
    adminRepository.listSupportTickets().then(setTickets).catch((e: unknown) => setError(errorText(e, 'Не удалось загрузить обращения')));
  }, [adminRepository]);
  useEffect(load, [load]);

  const toggleStatus = async (t: AdminSupportTicket): Promise<void> => {
    const next = t.status === 'open' ? 'closed' : 'open';
    setBusy(t.id);
    try {
      await adminRepository.setSupportTicketStatus(t.id, next);
      setTickets((list) => list?.map((x) => (x.id === t.id ? { ...x, status: next } : x)) ?? list);
    } catch (e) {
      toast.error(errorText(e, 'Не удалось изменить статус'));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <AdminError message={error} onRetry={load} />;
  if (!tickets) return <AdminLoading rows={4} />;
  if (tickets.length === 0) return <AdminEmpty icon={LifeBuoy} title="Обращений пока нет">Сообщения из формы помощи появятся здесь.</AdminEmpty>;

  const open = tickets.filter((t) => t.status === 'open').length;
  const shown = tickets.filter((t) => view === 'all' || t.status === view);
  return (
    <div className="space-y-3">
      <SegmentedControl value={view} onChange={setView} options={[
        { value: 'open', label: `Открытые · ${open}` },
        { value: 'closed', label: `Закрытые · ${tickets.length - open}` },
        { value: 'all', label: 'Все' },
      ]} />
      {shown.length === 0 ? (
        <AdminEmpty icon={LifeBuoy} title={view === 'open' ? 'Открытых обращений нет' : 'Закрытых обращений нет'} />
      ) : (
        <ul className={ADMIN_LIST_CLASS}>
          {shown.map((t) => (
            <li key={t.id} className={cn('flex items-start gap-3 px-3 py-2.5', t.status === 'closed' && 'text-muted-foreground')}>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
                  <span className="font-medium text-foreground">{t.submitterDisplayName ?? 'Аноним'}</span>
                  {t.submitterEmail && <span className="min-w-0 truncate text-muted-foreground">{t.submitterEmail}</span>}
                  <span className="pf-tag pf-tone-gray text-2xs">{t.source === 'landing' ? 'лендинг' : 'приложение'}</span>
                  {t.status === 'closed' && <span className="pf-tag pf-tone-done text-2xs">закрыто</span>}
                  <span className="text-muted-foreground">{relativeTime(new Date(t.createdAt))}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-ui">{t.message}</p>
              </div>
              <Button size="sm" variant={t.status === 'open' ? 'outline' : 'ghost'} disabled={busy === t.id} onClick={() => void toggleStatus(t)}>
                {t.status === 'open' ? 'Закрыть' : 'Открыть'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
