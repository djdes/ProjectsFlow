import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Plus, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { formatRub, rublesToKopecks } from '@/lib/money';
import type { Employee, ProjectFinance } from '@/domain/finance/types';
import { useContainer } from '@/infrastructure/di/container';
import { useProject } from '@/presentation/hooks/useProject';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (d: Date): string => dateFmt.format(d);
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function FinancePage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId ?? '';
  const { data: project } = useProject(pid);
  const { user } = useCurrentUser();
  const { projectFinanceRepository, employeeRepository } = useContainer();

  const canManage = project?.role === 'owner' || user?.isAdmin === true;

  const [finance, setFinance] = useState<ProjectFinance | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [forbidden, setForbidden] = useState(false);

  const reload = useCallback(() => {
    projectFinanceRepository
      .getSummary(pid)
      .then(setFinance)
      .catch(() => setForbidden(true));
  }, [pid, projectFinanceRepository]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (canManage) {
      employeeRepository.list().then(setEmployees).catch(() => undefined);
    }
  }, [canManage, employeeRepository]);

  if (forbidden) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold">Финансы недоступны</h1>
          <p className="text-sm text-muted-foreground">
            Доступ к финансам этого проекта есть только у владельца.
          </p>
          <Button asChild variant="outline">
            <Link to={`/projects/${pid}`}>К доске</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!finance || !project) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const profitPositive = finance.profitKopecks >= 0;
  const activeEmployees = employees.filter((e) => e.active);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link to="/" className="hover:text-foreground">Проекты</Link>
        <ChevronRight className="size-4" />
        <Link to={`/projects/${pid}`} className="hover:text-foreground">{project.name}</Link>
        <ChevronRight className="size-4" />
        <span className="text-foreground">Финансы</span>
      </nav>

      <div className="flex items-center gap-3">
        <Wallet className="size-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Финансы</h1>
      </div>

      {/* P&L */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Доход" value={formatRub(finance.incomeTotalKopecks)} />
        <Stat label="Зарплаты" value={formatRub(finance.laborTotalKopecks)} />
        <Stat label="Прочие расходы" value={formatRub(finance.otherExpensesTotalKopecks)} />
        <Stat
          label="Прибыль"
          value={formatRub(finance.profitKopecks)}
          valueClass={profitPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}
          hint={finance.marginPercent === null ? undefined : `маржа ${finance.marginPercent}%`}
        />
      </div>

      {/* Трудозатраты */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Трудозатраты по сотрудникам</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {finance.labor.length === 0 ? (
            <p className="text-sm text-muted-foreground">Сотрудники не назначены.</p>
          ) : (
            <ul className="divide-y">
              {finance.labor.map((l) => (
                <li key={l.assignmentId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRub(l.monthlySalaryKopecks)}/мес · {l.allocationPercent}% · c {fmtDate(l.startedAt)}
                      {l.endedAt ? ` по ${fmtDate(l.endedAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm tabular-nums">{formatRub(l.costKopecks)}</span>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        aria-label="Снять с проекта"
                        onClick={() => {
                          void projectFinanceRepository
                            .removeAssignment(pid, l.assignmentId)
                            .then(reload)
                            .catch((e) => toast.error((e as Error).message));
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <AssignForm
              employees={activeEmployees}
              defaultStart={isoDay(project.createdAt)}
              onAssign={(input) =>
                projectFinanceRepository.assign(pid, input).then(reload)
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Прочие расходы */}
      <LedgerCard
        title="Прочие расходы"
        items={finance.expenses.map((e) => ({
          id: e.id,
          left: e.category + (e.description ? ` · ${e.description}` : ''),
          date: e.incurredOn,
          amount: e.amountKopecks,
        }))}
        canManage={canManage}
        onDelete={(id) => projectFinanceRepository.deleteExpense(pid, id).then(reload)}
        addForm={
          canManage ? (
            <ExpenseForm onAdd={(input) => projectFinanceRepository.addExpense(pid, input).then(reload)} />
          ) : null
        }
        emptyText="Расходов нет."
      />

      {/* Доходы */}
      <LedgerCard
        title="Доходы"
        items={finance.incomes.map((i) => ({
          id: i.id,
          left: i.source ?? 'Доход',
          date: i.receivedOn,
          amount: i.amountKopecks,
        }))}
        canManage={canManage}
        onDelete={(id) => projectFinanceRepository.deleteIncome(pid, id).then(reload)}
        addForm={
          canManage ? (
            <IncomeForm onAdd={(input) => projectFinanceRepository.addIncome(pid, input).then(reload)} />
          ) : null
        }
        emptyText="Доходов нет."
        footnote="В будущем — автоимпорт из банка/платёжного сервиса."
      />

      {/* Видимость */}
      {canManage && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-medium">Показывать финансы всем участникам</p>
              <p className="text-xs text-muted-foreground">
                По умолчанию финансы видит только владелец и админ.
              </p>
            </div>
            <Button
              variant={project.financeVisibility === 'members' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                const next = project.financeVisibility === 'members' ? 'owner' : 'members';
                void projectFinanceRepository
                  .setVisibility(pid, next)
                  .then(() => toast.success(next === 'members' ? 'Видно всем участникам' : 'Видно только владельцу'))
                  .catch((e) => toast.error((e as Error).message));
              }}
            >
              {project.financeVisibility === 'members' ? 'Включено' : 'Выключено'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('truncate font-mono text-lg font-semibold tabular-nums', valueClass)}>{value}</p>
        {hint && <p className="truncate text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function AssignForm({
  employees,
  defaultStart,
  onAssign,
}: {
  employees: Employee[];
  defaultStart: string;
  onAssign: (input: { employeeId: string; allocationPercent: number; startedAt: string }) => Promise<void>;
}): React.ReactElement {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [percent, setPercent] = useState('100');
  const [start, setStart] = useState(defaultStart);
  const [saving, setSaving] = useState(false);
  const selected = employees.find((e) => e.id === employeeId);

  const submit = async (): Promise<void> => {
    if (!employeeId) {
      toast.error('Выберите сотрудника');
      return;
    }
    const alloc = Number(percent);
    if (!Number.isInteger(alloc) || alloc < 1 || alloc > 100) {
      toast.error('Доля — целое от 1 до 100');
      return;
    }
    setSaving(true);
    try {
      await onAssign({ employeeId, allocationPercent: alloc, startedAt: start });
      setEmployeeId(null);
      setPercent('100');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (employees.length === 0) {
    return (
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Нет активных сотрудников. Добавьте их в{' '}
        <Link to="/profile" className="text-primary hover:underline">профиле</Link>.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 items-end gap-2 border-t pt-3 sm:flex sm:flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs">Сотрудник</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full justify-start font-normal sm:w-44">
              <span className="truncate">{selected?.name ?? 'Выбрать…'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value={employeeId ?? ''} onValueChange={setEmployeeId}>
              {employees.map((e) => (
                <DropdownMenuRadioItem key={e.id} value={e.id}>
                  {e.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:contents">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="alloc">Доля %</Label>
          <Input id="alloc" className="sm:w-20" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="astart">С даты</Label>
          <Input id="astart" type="date" className="sm:w-40" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
      </div>
      <Button size="sm" className="w-full sm:w-auto" onClick={() => void submit()} disabled={saving}>
        <Plus className="size-4" /> Назначить
      </Button>
    </div>
  );
}

type LedgerItem = { id: string; left: string; date: Date; amount: number };

function LedgerCard({
  title,
  items,
  canManage,
  onDelete,
  addForm,
  emptyText,
  footnote,
}: {
  title: string;
  items: LedgerItem[];
  canManage: boolean;
  onDelete: (id: string) => Promise<void>;
  addForm: React.ReactNode;
  emptyText: string;
  footnote?: string;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{it.left}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(it.date)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm tabular-nums">{formatRub(it.amount)}</span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label="Удалить"
                      onClick={() => void onDelete(it.id).catch((e) => toast.error((e as Error).message))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {addForm}
        {footnote && <p className="text-[11px] text-muted-foreground/70">{footnote}</p>}
      </CardContent>
    </Card>
  );
}

function ExpenseForm({
  onAdd,
}: {
  onAdd: (input: { amountKopecks: number; category: string; description: string | null; incurredOn: string }) => Promise<void>;
}): React.ReactElement {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('ads');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(isoDay(new Date()));
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    const kop = rublesToKopecks(amount);
    if (kop <= 0) {
      toast.error('Введите сумму');
      return;
    }
    setSaving(true);
    try {
      await onAdd({ amountKopecks: kop, category, description: desc.trim() || null, incurredOn: date });
      setAmount('');
      setDesc('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-2 items-end gap-2 border-t pt-3 sm:flex sm:flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="exp-amount">Сумма ₽</Label>
        <Input id="exp-amount" className="sm:w-28" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="exp-cat">Категория</Label>
        <Input id="exp-cat" className="sm:w-28" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="exp-desc">Описание</Label>
        <Input id="exp-desc" className="sm:w-40" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="exp-date">Дата</Label>
        <Input id="exp-date" type="date" className="sm:w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Button size="sm" className="col-span-2 w-full sm:w-auto" onClick={() => void submit()} disabled={saving}>
        <Plus className="size-4" /> Добавить
      </Button>
    </div>
  );
}

function IncomeForm({
  onAdd,
}: {
  onAdd: (input: { amountKopecks: number; source: string | null; receivedOn: string }) => Promise<void>;
}): React.ReactElement {
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(isoDay(new Date()));
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    const kop = rublesToKopecks(amount);
    if (kop <= 0) {
      toast.error('Введите сумму');
      return;
    }
    setSaving(true);
    try {
      await onAdd({ amountKopecks: kop, source: source.trim() || null, receivedOn: date });
      setAmount('');
      setSource('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-2 items-end gap-2 border-t pt-3 sm:flex sm:flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="inc-amount">Сумма ₽</Label>
        <Input id="inc-amount" className="sm:w-28" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </div>
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <Label className="text-xs" htmlFor="inc-source">Источник</Label>
        <Input id="inc-source" className="sm:w-48" value={source} onChange={(e) => setSource(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="inc-date">Дата</Label>
        <Input id="inc-date" type="date" className="sm:w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Button size="sm" className="col-span-2 w-full sm:w-auto" onClick={() => void submit()} disabled={saving}>
        <Plus className="size-4" /> Добавить
      </Button>
    </div>
  );
}
