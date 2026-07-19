import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  Filter,
  KeyRound,
  ListOrdered,
  Loader2,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { cn } from '@/lib/utils';
import type {
  AppAccess,
  AppBackendDashboard,
  AppCrudRules,
  AppDataFilter,
  AppDataRow,
  AppField,
  AppFilterOperator,
  AppRowsPage,
  AppSensitiveKind,
  AppTableSchema,
} from '@/application/project/ProjectRepository';

const EMPTY_TABLES: AppTableSchema[] = [];

const PAGE_SIZE = 50;
const SYSTEM_COLUMNS = ['id', 'owner_id', 'created_at'] as const;
const ACCESS_OPTIONS: Array<{ value: AppAccess; label: string; hint: string }> = [
  { value: 'anyone', label: 'Все', hint: 'Даже без входа' },
  { value: 'authenticated', label: 'Авторизованные', hint: 'Любой пользователь приложения' },
  { value: 'owner', label: 'Владелец строки', hint: 'Только создатель записи' },
];

const OPERATOR_LABEL: Record<AppFilterOperator, string> = {
  eq: 'Равно',
  neq: 'Не равно',
  contains: 'Содержит',
  starts_with: 'Начинается с',
  gt: 'Больше',
  gte: 'Больше или равно',
  lt: 'Меньше',
  lte: 'Меньше или равно',
  is_empty: 'Пусто',
  is_not_empty: 'Не пусто',
};

function effectiveRules(table: AppTableSchema): AppCrudRules {
  return {
    create: table.rules.create ?? table.rules.write,
    read: table.rules.read,
    update: table.rules.update ?? table.rules.write,
    delete: table.rules.delete ?? table.rules.write,
  };
}

function fieldForColumn(table: AppTableSchema, column: string): AppField | null {
  return table.fields.find((field) => field.name === column) ?? null;
}

function operatorsFor(field: AppField | null): AppFilterOperator[] {
  if (!field || field.type === 'text') return ['contains', 'starts_with', 'eq', 'neq', 'is_empty', 'is_not_empty'];
  if (field.type === 'bool') return ['eq', 'neq', 'is_empty', 'is_not_empty'];
  return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
}

function displayValue(value: unknown, field: AppField | null): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field?.type === 'bool') return value === true || value === 1 ? 'Да' : 'Нет';
  if (field?.type === 'datetime') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AppDataExplorer({
  projectId,
  dashboard,
  canEdit,
  onDashboardChange,
}: {
  projectId: string;
  dashboard: AppBackendDashboard;
  canEdit: boolean;
  onDashboardChange: (dashboard: AppBackendDashboard) => void;
}): React.ReactElement {
  const { projectRepository } = useContainer();
  const tables = dashboard.schema?.tables ?? EMPTY_TABLES;
  const [selectedTableName, setSelectedTableName] = useState<string>(tables[0]?.name ?? '');
  const selectedTable = tables.find((table) => table.name === selectedTableName) ?? tables[0] ?? null;
  const [page, setPage] = useState<AppRowsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AppDataFilter[]>([]);
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' }>({ column: 'created_at', dir: 'desc' });
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [editingRow, setEditingRow] = useState<AppDataRow | 'new' | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [tableSearch, setTableSearch] = useState('');
  const [alphabetical, setAlphabetical] = useState(false);

  const visibleTables = useMemo(() => {
    const needle = tableSearch.trim().toLowerCase();
    const filtered = needle
      ? tables.filter((table) => table.name.toLowerCase().includes(needle))
      : [...tables];
    return alphabetical
      ? filtered.sort((left, right) => left.name.localeCompare(right.name, 'ru'))
      : filtered;
  }, [alphabetical, tableSearch, tables]);

  useEffect(() => {
    if (tables.length === 0) setSelectedTableName('');
    else if (!tables.some((table) => table.name === selectedTableName)) setSelectedTableName(tables[0]!.name);
  }, [selectedTableName, tables]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchDraft); setOffset(0); }, 280);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (!selectedTable) { setPage(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    projectRepository.queryAppRows(projectId, selectedTable.name, {
      search,
      filters,
      sort,
      limit: PAGE_SIZE,
      offset,
    }).then((result) => { if (!cancelled) setPage(result); })
      .catch(() => { if (!cancelled) { setPage(null); setError('Не удалось загрузить строки таблицы.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, offset, projectId, projectRepository, reload, search, selectedTable, sort]);

  if (dashboard.status !== 'active') {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed bg-muted/10 px-6">
        <div className="max-w-md text-center">
          <Database className="mx-auto size-7 text-muted-foreground" />
          <h3 className="mt-3 font-semibold">База приложения ещё не создана</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Когда воркер добавит серверную базу, таблицы сразу появятся в Dashboard.</p>
        </div>
      </div>
    );
  }

  if (tables.length === 0) {
    return <div className="grid min-h-[360px] place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">В схеме пока нет пользовательских таблиц.</div>;
  }

  const columns = selectedTable ? ['id', ...selectedTable.fields.map((field) => field.name), 'owner_id', 'created_at'] : [];
  const maxOffset = page ? Math.max(0, Math.floor(Math.max(0, page.total - 1) / PAGE_SIZE) * PAGE_SIZE) : 0;
  const masked: Readonly<Record<string, AppSensitiveKind>> = page?.masked ?? {};
  const applySort = (column: string): void => {
    setSort((current) => current.column === column
      ? { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { column, dir: 'asc' });
    setOffset(0);
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <aside className="shrink-0 overflow-hidden rounded-xl border bg-background lg:w-60">
        <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border px-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder="Поиск таблиц…"
            />
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-pressed={alphabetical}
            title={alphabetical ? 'Порядок схемы' : 'Сортировка А–Я'}
            onClick={() => setAlphabetical((value) => !value)}
          >
            {alphabetical ? <ArrowDownAZ className="size-4" /> : <ListOrdered className="size-4" />}
            <span className="sr-only">{alphabetical ? 'Вернуть порядок схемы' : 'Сортировать таблицы А–Я'}</span>
          </Button>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5 lg:max-h-[560px]">
          {visibleTables.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">Таблицы не найдены.</p>
          ) : visibleTables.map((table) => (
            <button
              key={table.name}
              type="button"
              onClick={() => { setSelectedTableName(table.name); setFilters([]); setOffset(0); }}
              className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors', selectedTable?.name === table.name ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}
            >
              <Database className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{table.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{table.fields.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-hidden rounded-xl border bg-background">
        <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
          <span className="min-w-0 truncate text-sm font-semibold">{selectedTable?.name ?? '—'}{page ? ` (${page.total})` : ''}</span>
          <span className="hidden h-5 w-px bg-border sm:block" />
          <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-md border px-2.5 sm:max-w-xs">
            <Search className="size-3.5 text-muted-foreground" />
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Поиск по полям…" />
            {searchDraft && <button type="button" onClick={() => setSearchDraft('')} aria-label="Очистить поиск"><X className="size-3.5 text-muted-foreground" /></button>}
          </label>
          {selectedTable && (
            <>
              <FilterPopover table={selectedTable} masked={masked} filters={filters} onChange={(next) => { setFilters(next); setOffset(0); }} />
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setPermissionsOpen(true)}><ShieldCheck className="size-3.5" /><span className="hidden sm:inline">Права</span></Button>
              {canEdit && <Button size="sm" className="h-9 gap-1.5" onClick={() => setEditingRow('new')}><Plus className="size-3.5" />Запись</Button>}
            </>
          )}
        </div>

        {filters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/15 px-3 py-2">
            {filters.map((filter, index) => (
              <span key={`${filter.column}-${index}`} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
                {filter.column} · {OPERATOR_LABEL[filter.operator]}{filter.value !== undefined ? ` · ${String(filter.value)}` : ''}
                <button type="button" onClick={() => setFilters(filters.filter((_, item) => item !== index))} aria-label="Убрать фильтр"><X className="size-3" /></button>
              </span>
            ))}
            <button type="button" className="px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setFilters([])}>Очистить</button>
          </div>
        )}

        <div className="relative min-h-[430px] overflow-auto">
          {loading && <div className="absolute inset-x-0 top-0 z-20 flex h-1 overflow-hidden bg-muted"><span className="h-full w-1/3 animate-pulse bg-primary" /></div>}
          {error ? (
            <div className="grid min-h-[430px] place-items-center text-center text-sm text-muted-foreground"><div><p>{error}</p><Button className="mt-3" variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>Повторить</Button></div></div>
          ) : (
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  {columns.map((column, columnIndex) => (
                    <th key={column} className={cn('min-w-[180px] border-b border-r px-3 py-2 text-left font-medium text-muted-foreground first:min-w-[220px]', columnIndex === 0 && 'sticky left-0 z-20 bg-background')}>
                      <button type="button" className="flex w-full items-center gap-1.5 hover:text-foreground" onClick={() => applySort(column)}>
                        {column === 'id' && <KeyRound className="size-3.5" />}
                        {masked[column] && <Lock className="size-3 text-amber-600" aria-label="Значения скрыты" />}
                        {column}
                        {sort.column === column && (sort.dir === 'asc' ? <ArrowUp className="ml-auto size-3.5" /> : <ArrowDown className="ml-auto size-3.5" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && (page?.rows.length ?? 0) === 0 ? (
                  <tr><td colSpan={columns.length} className="h-64 text-center text-sm text-muted-foreground">{filters.length || search ? 'По вашему запросу ничего не найдено.' : 'В таблице пока нет записей.'}</td></tr>
                ) : page?.rows.map((row, rowIndex) => (
                  <tr
                    key={String(row.id ?? rowIndex)}
                    tabIndex={0}
                    aria-label={`Открыть запись ${String(row.id ?? rowIndex + 1)}`}
                    className="group cursor-pointer hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => setEditingRow(row)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setEditingRow(row);
                    }}
                  >
                    {columns.map((column, columnIndex) => {
                      const field = selectedTable ? fieldForColumn(selectedTable, column) : null;
                      return <td key={column} className={cn('max-w-[360px] border-b border-r px-3 py-2.5', columnIndex === 0 && 'sticky left-0 z-[5] bg-background group-hover:bg-muted/35 group-focus-visible:bg-muted/35')}><span className={cn('block truncate', row[column] === null || row[column] === undefined || row[column] === '' ? 'text-muted-foreground/60' : 'text-foreground')}>{displayValue(row[column], field)}</span></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex min-h-12 items-center justify-between gap-3 border-t px-3 text-xs text-muted-foreground">
          <span>{page ? `${page.total} ${page.total === 1 ? 'запись' : 'записей'}` : '—'}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-8" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft className="size-4" /><span className="sr-only">Предыдущая страница</span></Button>
            <span className="min-w-16 text-center">{Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil((page?.total ?? 0) / PAGE_SIZE))}</span>
            <Button variant="ghost" size="icon" className="size-8" disabled={offset >= maxOffset || loading} onClick={() => setOffset(Math.min(maxOffset, offset + PAGE_SIZE))}><ChevronRight className="size-4" /><span className="sr-only">Следующая страница</span></Button>
          </div>
        </div>

        {selectedTable && (
          <>
            <RowEditorSheet
              open={editingRow !== null}
              row={editingRow}
              table={selectedTable}
              masked={masked}
              canEdit={canEdit}
              projectId={projectId}
              onOpenChange={(open) => { if (!open) setEditingRow(null); }}
              onSaved={() => { setEditingRow(null); setReload((value) => value + 1); }}
            />
            <PermissionsDialog
              open={permissionsOpen}
              onOpenChange={setPermissionsOpen}
              projectId={projectId}
              table={selectedTable}
              canEdit={canEdit}
              onSaved={(rules) => {
                if (!dashboard.schema) return;
                onDashboardChange({
                  ...dashboard,
                  schema: { tables: dashboard.schema.tables.map((table) => table.name === selectedTable.name ? { ...table, rules: { read: rules.read, write: rules.update, create: rules.create, update: rules.update, delete: rules.delete } } : table) },
                });
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function FilterPopover({ table, masked, filters, onChange }: { table: AppTableSchema; masked: Readonly<Record<string, AppSensitiveKind>>; filters: AppDataFilter[]; onChange: (filters: AppDataFilter[]) => void }): React.ReactElement {
  const columns = [...SYSTEM_COLUMNS, ...table.fields.map((field) => field.name)];
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState(table.fields[0]?.name ?? 'id');
  const field = fieldForColumn(table, column);
  // Секретную колонку сервер разрешает фильтровать только по заполненности — не предлагаем
  // операторы, на которых запрос гарантированно упадёт.
  const secretColumn = masked[column] === 'secret';
  const availableOperators = useMemo(
    () => (secretColumn ? (['is_empty', 'is_not_empty'] as AppFilterOperator[]) : operatorsFor(field)),
    [field, secretColumn],
  );
  const [operator, setOperator] = useState<AppFilterOperator>(availableOperators[0] ?? 'eq');
  const [value, setValue] = useState('');
  useEffect(() => { if (!availableOperators.includes(operator)) setOperator(availableOperators[0] ?? 'eq'); }, [availableOperators, operator]);
  const noValue = operator === 'is_empty' || operator === 'is_not_empty';
  const add = (): void => {
    if (!noValue && !value.trim()) return;
    onChange([...filters, { column, operator, ...(!noValue ? { value } : {}) }]);
    setValue('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-9 gap-1.5"><Filter className="size-3.5" /><span className="hidden sm:inline">Фильтр</span>{filters.length > 0 && <span className="rounded bg-muted px-1 text-[10px]">{filters.length}</span>}</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,420px)] p-3">
        <div className="mb-3 flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted-foreground" /><p className="text-sm font-semibold">Добавить фильтр</p></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Поле</span><select value={column} onChange={(event) => setColumn(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{columns.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Условие</span><select value={operator} onChange={(event) => setOperator(event.target.value as AppFilterOperator)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{availableOperators.map((item) => <option key={item} value={item}>{OPERATOR_LABEL[item]}</option>)}</select></label>
        </div>
        {!noValue && <label className="mt-2 block space-y-1"><span className="text-xs text-muted-foreground">Значение</span><input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add(); }} autoFocus className="h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/30" /></label>}
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={add} disabled={!noValue && !value.trim()}>Добавить</Button></div>
      </PopoverContent>
    </Popover>
  );
}

function RowEditorSheet({ open, onOpenChange, row, table, masked, canEdit, projectId, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; row: AppDataRow | 'new' | null; table: AppTableSchema; masked: Readonly<Record<string, AppSensitiveKind>>; canEdit: boolean; projectId: string; onSaved: () => void }): React.ReactElement {
  const { projectRepository } = useContainer();
  const isNew = row === 'new';
  const existingRow = row !== null && typeof row === 'object' ? row : null;
  const [values, setValues] = useState<AppDataRow>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revealing, setRevealing] = useState<string | null>(null);
  useEffect(() => {
    const next: AppDataRow = {};
    for (const field of table.fields) next[field.name] = existingRow ? existingRow[field.name] ?? '' : field.type === 'bool' ? false : '';
    setValues(next);
    setConfirmDelete(false);
    setRevealing(null);
  }, [existingRow, table]);
  const reveal = async (column: string): Promise<void> => {
    if (!existingRow) return;
    setRevealing(column);
    try {
      const value = await projectRepository.revealAppRowValue(projectId, table.name, String(existingRow.id), column);
      setValues((current) => ({ ...current, [column]: value ?? '' }));
    } catch { toast.error('Не удалось раскрыть значение. Нужны права редактора проекта.'); }
    finally { setRevealing(null); }
  };
  const save = async (): Promise<void> => {
    if (!canEdit || !row) return;
    setSaving(true);
    try {
      if (isNew) await projectRepository.createAppRow(projectId, table.name, values);
      else if (existingRow) await projectRepository.updateAppRow(projectId, table.name, String(existingRow.id), values);
      toast.success(isNew ? 'Запись создана' : 'Изменения сохранены');
      onSaved();
    } catch { toast.error('Не удалось сохранить запись. Проверьте обязательные поля.'); }
    finally { setSaving(false); }
  };
  const remove = async (): Promise<void> => {
    if (!existingRow) return;
    setSaving(true);
    try { await projectRepository.deleteAppRow(projectId, table.name, String(existingRow.id)); toast.success('Запись удалена'); onSaved(); }
    catch { toast.error('Не удалось удалить запись'); }
    finally { setSaving(false); setConfirmDelete(false); }
  };
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-5 py-4 text-left"><SheetTitle>{isNew ? 'Новая запись' : `Запись · ${table.name}`}</SheetTitle><SheetDescription>{isNew ? 'Заполните поля схемы таблицы.' : String(existingRow?.id ?? '')}</SheetDescription></SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {existingRow && SYSTEM_COLUMNS.map((column) => <div key={column} className="grid gap-1 sm:grid-cols-[140px_1fr]"><span className="text-xs font-medium text-muted-foreground">{column}</span><span className="break-all text-sm">{displayValue(existingRow[column], null)}</span></div>)}
            {!isNew && <div className="border-t" />}
            {table.fields.map((field) => (
              <FieldEditor
                key={field.name}
                field={field}
                value={values[field.name]}
                sensitive={masked[field.name] ?? null}
                revealing={revealing === field.name}
                onReveal={!isNew && existingRow ? () => void reveal(field.name) : null}
                disabled={!canEdit || saving}
                onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
              />
            ))}
          </div>
          <div className="flex items-center justify-between border-t px-5 py-3">
            {!isNew && canEdit ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} disabled={saving}><Trash2 className="mr-1.5 size-4" />Удалить</Button> : <span />}
            <div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button>{canEdit && <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}{isNew ? 'Создать' : 'Сохранить'}</Button>}</div>
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent><DialogHeader><DialogTitle>Удалить запись?</DialogTitle><DialogDescription>Действие нельзя отменить. Связанные данные приложения могут перестать отображаться.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmDelete(false)}>Отмена</Button><Button variant="destructive" onClick={() => void remove()} disabled={saving}>Удалить</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}

function FieldEditor({ field, value, sensitive, revealing, onReveal, disabled, onChange }: { field: AppField; value: unknown; sensitive: AppSensitiveKind | null; revealing: boolean; onReveal: (() => void) | null; disabled: boolean; onChange: (value: unknown) => void }): React.ReactElement {
  const label = (
    <span className="flex items-center gap-1.5 text-sm font-medium">
      {sensitive && <Lock className="size-3 text-amber-600" />}
      {field.name}{field.required && <span className="ml-0.5 text-destructive">*</span>}
      <span className="text-xs font-normal text-muted-foreground">{field.type}{field.unique ? ' · unique' : ''}</span>
      {sensitive && (
        <span className="text-xs font-normal text-amber-700 dark:text-amber-500">
          {sensitive === 'secret' ? '· секрет, скрыт' : '· персональные данные, скрыты'}
        </span>
      )}
      {sensitive && onReveal && (
        <button type="button" onClick={onReveal} disabled={revealing} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground">
          {revealing ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}Показать
        </button>
      )}
    </span>
  );
  if (field.type === 'bool') {
    const checked = value === true;
    return <label className="flex items-center justify-between rounded-lg border px-3 py-3">{label}<button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cn('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted')}><span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} /></button></label>;
  }
  let inputValue = value === null || value === undefined ? '' : String(value);
  let type = 'text';
  if (field.type === 'int' || field.type === 'real') type = 'number';
  if (field.type === 'datetime') { type = 'datetime-local'; const date = new Date(inputValue); if (!Number.isNaN(date.getTime())) inputValue = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
  return <label className="block space-y-1.5">{label}<input type={type} step={field.type === 'int' ? '1' : field.type === 'real' ? 'any' : undefined} required={field.required} disabled={disabled} value={inputValue} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60" /></label>;
}

function PermissionsDialog({ open, onOpenChange, projectId, table, canEdit, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; table: AppTableSchema; canEdit: boolean; onSaved: (rules: AppCrudRules) => void }): React.ReactElement {
  const { projectRepository } = useContainer();
  const [rules, setRules] = useState<AppCrudRules>(() => effectiveRules(table));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setRules(effectiveRules(table)); }, [open, table]);
  const save = async (): Promise<void> => { setSaving(true); try { const result = await projectRepository.updateAppTablePermissions(projectId, table.name, rules); onSaved(result); toast.success('Права доступа сохранены'); onOpenChange(false); } catch { toast.error('Не удалось сохранить права'); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Права · {table.name}</DialogTitle><DialogDescription>Кто может выполнять операции через публичный API приложения. Участники проекта с правом редактирования по-прежнему управляют данными через Dashboard.</DialogDescription></DialogHeader><div className="overflow-hidden rounded-lg border"><div className="grid grid-cols-[130px_1fr] border-b bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground"><span>Операция</span><span>Доступ</span></div>{(['create', 'read', 'update', 'delete'] as const).map((operation) => <div key={operation} className="grid grid-cols-[130px_1fr] items-center border-b px-3 py-2.5 last:border-b-0"><span className="text-sm font-medium capitalize">{operation}</span><select value={rules[operation]} disabled={!canEdit || saving} onChange={(event) => setRules((current) => ({ ...current, [operation]: event.target.value as AppAccess }))} className="h-9 rounded-md border bg-background px-2 text-sm">{ACCESS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.hint}</option>)}</select></div>)}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button>{canEdit && <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}Сохранить</Button>}</DialogFooter></DialogContent></Dialog>;
}
