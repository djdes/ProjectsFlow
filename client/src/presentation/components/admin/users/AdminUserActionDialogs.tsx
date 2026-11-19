import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { AdminPlanTerm } from '@/application/admin/AdminRepository';
import { pluralRu } from '@/presentation/components/admin/mailing/mailingFormat';

// Confirmation for one-step admin actions (role, sessions, password link): the action runs
// only from the dialog's own button, the dialog stays until it finishes and shows its error.
export function AdminConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось выполнить действие');
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent hideClose={busy} data-admin-confirm>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="break-words">{description}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={() => void run()} disabled={busy}>
            {busy ? 'Выполняем…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TermKind = 'extend' | 'until' | 'unlimited';
const EXTEND_OPTIONS = [{ days: 7, label: '+7 дней' }, { days: 30, label: '+30 дней' }, { days: 365, label: '+1 год' }] as const;

const dateInput = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Bulk «Тариф и срок»: one plan and one term for every selected user. Running terms of the
// same plan are extended from their own end date (the server applies it per user).
export function BulkPlanDialog({
  count,
  onSubmit,
  onClose,
}: {
  count: number;
  onSubmit: (input: { plan: 'prime' | 'vip'; term: AdminPlanTerm }) => Promise<void>;
  onClose: () => void;
}): React.ReactElement {
  const [plan, setPlan] = useState<'prime' | 'vip'>('prime');
  const [kind, setKind] = useState<TermKind>('extend');
  const [days, setDays] = useState<number>(30);
  const [until, setUntil] = useState(() => dateInput(new Date(Date.now() + 30 * 86400000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    let term: AdminPlanTerm;
    if (kind === 'extend') term = { kind, days };
    else if (kind === 'unlimited') term = { kind };
    else {
      // End of the chosen day in the admin's time zone.
      const end = new Date(`${until}T23:59:00`);
      if (!until || !Number.isFinite(end.getTime()) || end.getTime() <= Date.now() || end.getTime() > Date.parse('2038-01-19T03:14:07Z')) {
        setError('Укажите дату в будущем до 19 января 2038 года'); return;
      }
      term = { kind, date: end.toISOString() };
    }
    setBusy(true); setError('');
    try {
      await onSubmit({ plan, term });
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось изменить тариф');
      setBusy(false);
    }
  };

  const who = `${count} ${pluralRu(count, 'пользователю', 'пользователям', 'пользователям')}`;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent hideClose={busy} data-admin-bulk-plan>
        <DialogHeader>
          <DialogTitle>Тариф для выбранных</DialogTitle>
          <DialogDescription>Изменение получат {who}. Каждое изменение попадёт в историю действий.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Тариф</span>
              <SegmentedControl value={plan} onChange={setPlan} options={[{ value: 'prime', label: 'Прайм' }, { value: 'vip', label: 'VIP' }]} />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-medium">Срок</span>
              <SegmentedControl className="flex w-full [&>*]:flex-1" value={kind} onChange={setKind}
                options={[{ value: 'extend', label: 'Продлить' }, { value: 'until', label: 'До даты' }, { value: 'unlimited', label: 'Бессрочно' }]} />
              {kind === 'extend' && (
                <>
                  <SegmentedControl size="sm" value={String(days)} onChange={(v) => setDays(Number(v))}
                    options={EXTEND_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))} />
                  <p className="text-xs text-muted-foreground">
                    Если у пользователя уже идёт этот тариф, дни добавятся к дате окончания, иначе отсчёт пойдёт от сегодня.
                    Бессрочный тариф останется бессрочным.
                  </p>
                </>
              )}
              {kind === 'until' && (
                <div className="space-y-1">
                  <Label htmlFor="bulk-plan-until">Последний день тарифа</Label>
                  <Input id="bulk-plan-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} required />
                </div>
              )}
              {kind === 'unlimited' && <p className="text-xs text-muted-foreground">Тариф будет действовать без срока окончания.</p>}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Применяем…' : `Применить к ${count}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
