import { useCallback, useEffect, useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import type { CampaignStatus, DeliveryStatus, MailingChannel, MailingPage } from '@/domain/mailing/Mailing';

export const PANEL = 'rounded-xl bg-card p-4 shadow-card';
export const FIELD = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
export const CHANNEL_NAMES: Record<MailingChannel, string> = { email: 'Почта', telegram: 'Telegram', site: 'Колокольчик' };
export const STATUS_NAMES: Record<CampaignStatus, string> = { draft: 'Черновик', scheduled: 'Запланирована', sending: 'Отправляется', done: 'Завершена', cancelled: 'Отменена' };
export const DELIVERY_NAMES: Record<DeliveryStatus, string> = { queued: 'В очереди', sending: 'Отправляется', sent: 'Отправлено', failed: 'Ошибка', skipped: 'Пропущено', cancelled: 'Отменено' };
export const errorText = (value: unknown): string => value instanceof Error ? value.message : 'Не удалось выполнить действие. Попробуйте ещё раз';
export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}
export function useMailingResource<T>(load: () => Promise<T>, keepPrevious = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(null); if (!keepPrevious) setData(null);
    void load().then(value => { if (active) setData(value); }).catch(err => { if (active) setError(errorText(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, version, keepPrevious]);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  return { data, error, loading, reload };
}
export function LoadState({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }): React.ReactElement | null {
  if (error) return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 p-4 text-sm"><AlertCircle className="size-4 shrink-0 text-destructive" /><span className="min-w-0 flex-1 break-words">{error}</span><Button variant="outline" size="sm" onClick={retry}>Повторить</Button></div>;
  return loading ? <LoadingRegion className="space-y-3"><Skeleton className="h-9 w-56" /><Skeleton className="h-28 w-full rounded-xl" /></LoadingRegion> : null;
}
export function BusyIcon() { return <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />; }
export function CheckChoice({ checked, onChange, children, disabled }: { checked: boolean | 'indeterminate'; onChange: (value: boolean) => void; children: ReactNode; disabled?: boolean }) {
  const id = useId();
  return <div className="flex min-w-0 items-center gap-2"><Checkbox id={id} checked={checked} onCheckedChange={value => onChange(value === true)} disabled={disabled} /><Label htmlFor={id} className="min-w-0 cursor-pointer break-words text-sm font-normal">{children}</Label></div>;
}
export function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return <div className="min-w-0 space-y-1.5"><Label htmlFor={id}>{label}</Label><select {...props} id={id} className={FIELD}>{children}</select></div>;
}
export function Pager({ data, onPage }: { data: Pick<MailingPage<unknown>, 'page' | 'pageSize' | 'total'>; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>Всего: {data.total} · Страница {data.page} из {pages}</span><div className="flex gap-1"><Button size="sm" variant="outline" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label="Предыдущая страница"><ChevronLeft className="size-4" /></Button><Button size="sm" variant="outline" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)} aria-label="Следующая страница"><ChevronRight className="size-4" /></Button></div></div>;
}
