# Spec #2: Создание проекта (mock layer)

**Дата:** 2026-05-14
**Статус:** Утверждён (брейншторм)
**Зависит от:** [Spec #1 (UI-скелет)](2026-05-14-platform-ui-skeleton-design.md)

---

## 1. Контекст и scope

### Цель

Дать возможность пользователю создать новый проект в платформе ProjectsFlow. Mock-layer (без backend). После этой спеки кнопка `+ Новый проект` в сайдбаре открывает диалог с одним полем (название), создаёт проект, и пользователь переходит на его страницу.

### Продуктовая рамка

Платформа — **операционная тетрадь** на сайты/ПО (см. memory `project_product_vision`). Поэтому модель проекта **намеренно минимальная**: при создании мы знаем только имя. Всё остальное — URL, git-репо, стек, описание, теги — пользователь добавит позже на странице проекта (отдельные будущие спеки), когда дойдут руки.

Принцип: «не заставлять пользователя категоризовать то, что он ещё не знает как категоризовать».

### Что ВНУТРИ scope

- Упрощение domain-сущности `Project`: убираем поле `type` (и enum `ProjectType`).
- Use-case `CreateProject` + метод `create` на `ProjectRepository`.
- Mock-реализация в `MockProjectRepository`.
- UI: модальный диалог с полем `Название *`, валидация uniqueness, navigation после создания.
- `ProjectsProvider` для реактивного списка (новый проект сразу виден в сайдбаре).
- Удаление type-badge со страницы проекта.

### Что СНАРУЖИ scope

| Тема | Куда уйдёт |
|---|---|
| Редактирование проекта (имени, статуса) | Spec про project page edit |
| Удаление проекта | Spec про project page edit (или отдельная) |
| Поля URL/git/описание/теги/стек/хостинг | Отдельные секционные спеки |
| Реальный backend для создания | Spec #3 (backend skeleton) |
| Auth, multi-tenancy, изоляция по tenant_id | Spec #4-5 |
| Импорт из git/CSV/sitemap | Будущее |
| Сменa иконки проекту вручную | Будущее (если возникнет потребность) |

---

## 2. Изменения в domain

### 2.1 Project entity — урезаем

**Было:**
```ts
type Project = {
  readonly id: string;
  readonly name: string;
  readonly type: ProjectType;
  readonly status: ProjectStatus;
  readonly createdAt: Date;
};
```

**Станет:**
```ts
type Project = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly createdAt: Date;
};
```

### 2.2 `ProjectType.ts` — удалить

Файл `client/src/domain/project/ProjectType.ts` сейчас экспортирует `ProjectType` и `ProjectStatus`. После урезания `ProjectType` исчезает. `ProjectStatus` перемещается в `Project.ts` (или остаётся в том же файле, но переименован в `ProjectStatus.ts`).

Решение: переместить `ProjectStatus` прямо в `Project.ts` (вместе с `Project`). Файл `ProjectType.ts` удалить. Меньше файлов — меньше сущностей.

### 2.3 Доменные ошибки

Новый файл `domain/project/errors.ts`:

```ts
export class ProjectNameAlreadyExistsError extends Error {
  constructor(public readonly name: string) {
    super(`Project with name "${name}" already exists`);
    this.name = 'ProjectNameAlreadyExistsError';
  }
}

export class ProjectNameEmptyError extends Error {
  constructor() {
    super('Project name cannot be empty');
    this.name = 'ProjectNameEmptyError';
  }
}
```

Эти ошибки — часть domain (доменные правила), не infra. Use-case и репо их бросают; presentation ловит и показывает.

---

## 3. Изменения в application

### 3.1 `ProjectRepository` — новый метод

```ts
export type CreateProjectInput = {
  readonly name: string;   // pre-trimmed
};

export interface ProjectRepository {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
}
```

`create` бросает `ProjectNameAlreadyExistsError` если имя занято.

### 3.2 Use-case `CreateProject`

```ts
// application/project/CreateProject.ts
import { ProjectNameEmptyError } from '@/domain/project/errors';

export class CreateProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(rawName: string): Promise<Project> {
    const name = rawName.trim();
    if (name.length === 0) throw new ProjectNameEmptyError();
    return this.repo.create({ name });
  }
}
```

Use-case владеет правилом «trim + не пустое». Repo владеет правилом uniqueness (потому что в будущем это DB UNIQUE constraint).

---

## 4. Изменения в infrastructure

### 4.1 `MockProjectRepository.create`

```ts
import { ProjectNameAlreadyExistsError } from '@/domain/project/errors';

export class MockProjectRepository implements ProjectRepository {
  private readonly projects: Project[] = [...seedProjects];

  // ...list, getById...

  async create(input: CreateProjectInput): Promise<Project> {
    const normalized = input.name.trim().toLocaleLowerCase('ru');
    const exists = this.projects.some(
      (p) => p.name.trim().toLocaleLowerCase('ru') === normalized,
    );
    if (exists) throw new ProjectNameAlreadyExistsError(input.name);

    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name,
      status: 'active',
      createdAt: new Date(),
    };
    this.projects.unshift(project);   // новые наверху списка
    return delay(project);
  }
}
```

**Uniqueness rule:** case-insensitive, после trim. То есть `"acme.com"`, `"Acme.com"`, `"  ACME.COM  "` считаются одним именем. В БД (будущее) — индекс `UNIQUE` на `LOWER(name)`.

**Generation:** `crypto.randomUUID()` (нативный). Когда придёт бэк — id будет генерироваться на сервере (ULID). Frontend это не заметит — `Project.id` это `string` в обоих случаях.

**Order:** новые проекты добавляются в начало списка (`unshift`). Это значит, в сайдбаре только что созданный сразу наверху → user видит результат своего действия там, где он его ждёт.

### 4.2 `seed-data.ts` — обновить

Убрать `type` из всех 4 моков. Структура `Project` теперь меньше.

---

## 5. Изменения в presentation

### 5.1 `ProjectsProvider` — общий стейт списка

Аналогично `CurrentUserProvider`. Хранит список проектов в React-стейте, экспонирует `useProjects()` и `applyAppend(project)` для оптимистичного обновления:

```tsx
// presentation/hooks/ProjectsProvider.tsx
type ProjectsContextValue = {
  data: Project[] | null;
  loading: boolean;
  error: Error | null;
  applyAppend: (p: Project) => void;
};
```

`useEffect` грузит `listProjects.execute()` один раз при монтировании. `useProjects()` хук возвращает данные. `useCreateProject` после успешного создания вызывает `applyAppend(newProject)`, и сайдбар видит обновление мгновенно (без повторного fetch).

### 5.2 Хук `useCreateProject`

```ts
// presentation/hooks/useCreateProject.ts
export function useCreateProject(): {
  submit: (name: string) => Promise<Project>;
  saving: boolean;
  error: Error | null;
} {
  const { createProject } = useContainer();
  const { applyAppend } = useProjectsContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (name: string): Promise<Project> => {
    setSaving(true);
    setError(null);
    try {
      const p = await createProject.execute(name);
      applyAppend(p);
      return p;
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  return { submit, saving, error };
}
```

### 5.3 Новый shadcn-примитив: `Dialog`

```bash
npx shadcn@latest add dialog
```

Или вручную: `src/components/ui/dialog.tsx` — обёртка над `@radix-ui/react-dialog` (зависимость уже стоит для Sheet).

### 5.4 `NewProjectDialog`

```tsx
// presentation/components/forms/NewProjectDialog.tsx
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewProjectDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { submit, saving } = useCreateProject();
  const { data: projects } = useProjects();
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Client-side uniqueness check как hint до сабмита.
  // Server-check всё равно в репо — это просто UX.
  const trimmed = name.trim();
  const localDuplicate = trimmed.length > 0 && projects?.some(
    (p) => p.name.trim().toLocaleLowerCase('ru') === trimmed.toLocaleLowerCase('ru')
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    try {
      const p = await submit(name);
      onOpenChange(false);
      setName('');
      navigate(`/projects/${p.id}`);
    } catch (err) {
      if (err instanceof ProjectNameAlreadyExistsError) {
        setSubmitError('Проект с таким именем уже существует');
      } else if (err instanceof ProjectNameEmptyError) {
        setSubmitError('Введите название');
      } else {
        setSubmitError('Не удалось создать проект');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый проект</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="projectName">Название *</Label>
            <Input
              id="projectName"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(submitError) || localDuplicate}
            />
            {localDuplicate && !submitError && (
              <p className="text-xs text-muted-foreground">
                Проект с таким именем уже есть — кнопка «Создать» недоступна.
              </p>
            )}
            {submitError && (
              <p className="text-xs text-destructive">{submitError}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={saving || trimmed.length === 0 || localDuplicate}
            >
              {saving ? 'Создаём…' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### 5.5 `Sidebar` — переключить кнопку

Сейчас `+ Новый проект` показывает toast. Заменить на открытие диалога через локальный `useState`.

### 5.6 `Sidebar` иконки проектов

`projectIcons.tsx` упрощаем: `getProjectIcon()` исчезает (нет `type`). Все проекты получают одну иконку — `Folder` из lucide. `getInitials` остаётся (используется для аватара пользователя).

### 5.7 `ProjectPage` — убрать type-badge

Текущий код показывает два бейджа: `[Сайт] [Активен]`. Type-бейдж убрать. Остаётся только status-badge.

---

## 6. Acceptance criteria

### Сборка
- [ ] `npm run typecheck` чистый.
- [ ] `npm run build` чистый.
- [ ] `npm run lint` чистый, boundaries-правила не нарушены.

### Создание проекта (happy path)
- [ ] Клик `+ Новый проект` → открывается диалог.
- [ ] Поле «Название» с автофокусом.
- [ ] Ввод имени, клик «Создать» → диалог закрывается, происходит navigation на `/projects/:newId`.
- [ ] Новый проект сразу появляется в сайдбаре, наверху списка.
- [ ] Новый проект подсвечен как активный (т.к. мы на его странице).
- [ ] При mock-latency 120ms кнопка «Создать» — disabled + текст «Создаём…».

### Валидация
- [ ] Пустое имя → кнопка `Создать` disabled.
- [ ] Whitespace-only имя → кнопка disabled (после `trim()`).
- [ ] Имя дубликат (case-insensitive) → кнопка disabled, под полем подсказка «Проект с таким именем уже есть».
- [ ] Попытка отправить дубликат (e.g., race) → подсказка «Проект с таким именем уже существует».
- [ ] `Escape` закрывает диалог.
- [ ] Кнопка `Отмена` закрывает диалог.
- [ ] Закрытие диалога сбрасывает поле name.

### Domain/Architecture
- [ ] Доменные ошибки (`ProjectNameAlreadyExistsError`, `ProjectNameEmptyError`) живут в `domain/project/errors.ts`.
- [ ] Use-case `CreateProject` владеет правилом «trim + не пустое».
- [ ] Repo владеет правилом uniqueness (бросает доменную ошибку при дубликате).
- [ ] `ProjectsProvider` подменяет `useProjects` — все компоненты получают одинаковый источник.
- [ ] ESLint boundaries не нарушены (presentation не импортирует mocks напрямую).

### Visual
- [ ] Все проекты в сайдбаре с одинаковой иконкой `Folder`.
- [ ] Type-badge не видно ни на странице проекта, ни в сайдбаре.

---

## 7. Открытые вопросы

Нет. Все решения зафиксированы:
1. Поля при создании — только `name`.
2. `type` убираем из entity целиком (флексибельность через теги в будущем).
3. Uniqueness — case-insensitive, после trim.
4. Дубликат-чек — client-side (UX) + server-side (authoritative).
5. ULID — генерим через `crypto.randomUUID()` (нативно).
6. Иконка проекта в сайдбаре — одна `Folder` для всех.
7. Диалог — shadcn `Dialog` (modal).

---

## 8. Риски

| Риск | Митигация |
|---|---|
| `crypto.randomUUID()` несовместимо со старыми браузерами | Не релевантно: продукт под современные браузеры. Если понадобится polyfill — в будущей спеке. |
| `toLocaleLowerCase('ru')` ведёт себя по-разному в разных рантаймах | Mock и будущий backend оба будут на JS-V8, поведение совпадает. Для других backend-стэков — задокументировать. |
| Race condition между client-side check и submit | Покрыто: server-side check в репо всё равно бросит ошибку, presentation её покажет. |
| Удаление `type` сломает существующий код | Покрыто рефакторингом в этой же спеке: seed-data, ProjectPage, SidebarProjectList, projectIcons. ESLint + tsc поймают остаточные ссылки. |
