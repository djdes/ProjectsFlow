import { useEffect, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { formatRub, kopecksToRubles, rublesToKopecks } from '@/lib/money';
import type { Employee } from '@/domain/finance/types';
import { useContainer } from '@/infrastructure/di/container';

// Личный ростер сотрудников для учёта трудозатрат по проектам (раздел профиля).
export function EmployeesCard(): React.ReactElement {
  const { employeeRepository } = useContainer();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = (): void => {
    employeeRepository.list().then(setEmployees).catch(() => undefined);
  };
  useEffect(reload, [employeeRepository]);

  const active = employees.filter((e) => e.active);

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <Users className="size-4 text-muted-foreground" />
        <CardTitle className="text-base">Сотрудники</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Оклады используются для расчёта трудозатрат по проектам (раздел «Финансы»).
        </p>

        {active.length > 0 && (
          <ul className="divide-y rounded-md border">
            {active.map((e) =>
              editingId === e.id ? (
                <EditRow
                  key={e.id}
                  employee={e}
                  onCancel={() => setEditingId(null)}
                  onSave={async (name, kopecks) => {
                    await employeeRepository.update(e.id, { name, monthlySalaryKopecks: kopecks });
                    setEditingId(null);
                    reload();
                  }}
                />
              ) : (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">{formatRub(e.monthlySalaryKopecks)}/мес</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(e.id)}>
                      Изменить
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        void employeeRepository
                          .archive(e.id)
                          .then(() => {
                            toast.success('Сотрудник архивирован');
                            reload();
                          })
                          .catch((err) => toast.error((err as Error).message));
                      }}
                    >
                      Архивировать
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        <AddRow
          onAdd={async (name, kopecks) => {
            await employeeRepository.create({ name, monthlySalaryKopecks: kopecks });
            reload();
          }}
        />
      </CardContent>
    </Card>
  );
}

function AddRow({
  onAdd,
}: {
  onAdd: (name: string, kopecks: number) => Promise<void>;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [salary, setSalary] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    if (name.trim().length === 0) {
      toast.error('Введите имя');
      return;
    }
    setSaving(true);
    try {
      await onAdd(name.trim(), rublesToKopecks(salary));
      setName('');
      setSalary('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="emp-name">Имя</Label>
        <Input id="emp-name" className="w-44" value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Программист" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="emp-salary">Оклад ₽/мес</Label>
        <Input id="emp-salary" className="w-32" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="100000" />
      </div>
      <Button size="sm" onClick={() => void submit()} disabled={saving}>
        <Plus className="size-4" /> Добавить
      </Button>
    </div>
  );
}

function EditRow({
  employee,
  onSave,
  onCancel,
}: {
  employee: Employee;
  onSave: (name: string, kopecks: number) => Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(employee.name);
  const [salary, setSalary] = useState(String(kopecksToRubles(employee.monthlySalaryKopecks)));
  const [saving, setSaving] = useState(false);

  return (
    <li className="flex flex-wrap items-end gap-2 px-3 py-2">
      <div className="space-y-1">
        <Label className="text-xs">Имя</Label>
        <Input className="w-44" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Оклад ₽/мес</Label>
        <Input className="w-32" value={salary} onChange={(e) => setSalary(e.target.value)} />
      </div>
      <Button
        size="sm"
        disabled={saving}
        onClick={() => {
          if (name.trim().length === 0) {
            toast.error('Введите имя');
            return;
          }
          setSaving(true);
          void onSave(name.trim(), rublesToKopecks(salary))
            .catch((e) => toast.error((e as Error).message))
            .finally(() => setSaving(false));
        }}
      >
        Сохранить
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        Отмена
      </Button>
    </li>
  );
}
