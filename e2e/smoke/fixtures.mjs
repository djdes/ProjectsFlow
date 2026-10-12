// Deterministic fixtures and an in-browser API router for the smoke tests.
//
// Every browser context gets its own router (createApiRouter), so a mutation in one
// scenario never leaks into another. Nothing reaches a real server: GET requests are
// answered from the fixture state, mutations are journaled and answered plausibly,
// streams (SSE) are aborted, unknown GETs get `{}` and are listed in the report.

const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar date in Europe/Moscow (the browser timezone of every scenario), YYYY-MM-DD.
// Moscow has no DST, so shifting by whole days in UTC is safe.
export function moscowDate(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * DAY_MS));
}

const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const ME = {
  id: 'u-anna',
  email: 'anna@smoke.test',
  displayName: 'Анна Смирнова',
  avatarUrl: null,
  isAdmin: true,
  createdAt: '2025-01-15T09:00:00.000Z',
};

export const COLLEAGUES = [
  { id: 'u-boris', email: 'boris@smoke.test', displayName: 'Борис Котов', avatarUrl: null },
  { id: 'u-vera', email: 'vera@smoke.test', displayName: 'Вера Лебедева', avatarUrl: null },
  { id: 'u-gleb', email: 'gleb@smoke.test', displayName: 'Глеб Орлов', avatarUrl: null },
];

const PEOPLE = [ME, ...COLLEAGUES];
const person = (id) => PEOPLE.find((p) => p.id === id);

export const WORKSPACE_ID = 'ws-team';
export const INBOX_ID = 'p-inbox-anna';
const VERA_INBOX_ID = 'p-inbox-vera';

// Project used by the board / overview scenarios.
export const BOARD_PROJECT_ID = 'p-site';

const PROJECT_SEEDS = [
  { id: 'p-site', name: 'Сайт клиники', icon: '🏥', description: 'Новый сайт сети клиник: запись онлайн, врачи, цены.' },
  { id: 'p-shop', name: 'Интернет-магазин', icon: '🛒', description: 'Каталог, корзина и оплата.' },
  { id: 'p-crm', name: 'CRM-интеграция', icon: '🔗', description: 'Синхронизация заявок с CRM.' },
  { id: 'p-mobile', name: 'Мобильное приложение', icon: '📱', description: 'iOS и Android клиенты.' },
  { id: 'p-docs', name: 'Документация', icon: '📚', description: 'Регламенты и инструкции команды.' },
];

function projectDto(seed, extra = {}) {
  return {
    id: seed.id,
    ownerId: ME.id,
    name: seed.name,
    icon: seed.icon ?? null,
    status: 'active',
    gitRepoUrl: null,
    kbRepoFullName: null,
    kbKind: 'none',
    isInbox: false,
    workspaceId: WORKSPACE_ID,
    role: 'owner',
    memberCount: 4,
    taskCount: 0,
    financeVisibility: 'owner',
    dispatcherUserId: null,
    multiTaskWorker: false,
    isFavorite: false,
    favoriteSortOrder: 0,
    description: seed.description ?? null,
    coverUrl: null,
    coverPosition: 50,
    publicSlug: null,
    isPublic: false,
    publicIndexing: false,
    publicAppearance: null,
    appRepoFullName: null,
    createdAt: '2025-03-01T10:00:00.000Z',
    ...extra,
  };
}

const assigneeRef = (id) => {
  const p = person(id);
  return { userId: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl };
};

let positionSeq = 0;
function taskDto({
  id,
  projectId,
  title,
  body = '',
  status,
  assignee = ME.id,
  creator = ME.id,
  deadline = null,
  priority = null,
  taskType = null,
  createdHoursAgo = 48,
}) {
  positionSeq += 1;
  return {
    id,
    projectId,
    description: body ? `${title}\n${body}` : title,
    icon: null,
    cover: null,
    coverPosition: 50,
    status,
    statusBeforeDone: null,
    position: positionSeq,
    creator: assigneeRef(creator),
    assignee: assigneeRef(assignee),
    createdAt: hoursAgo(createdHoursAgo),
    updatedAt: hoursAgo(Math.max(1, createdHoursAgo - 5)),
    commitCount: 0,
    attachmentCount: 0,
    commentCount: 0,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline,
    startDate: null,
    parentTaskId: null,
    priority,
    taskType,
  };
}

// Fresh, mutable state for one browser context.
export function createState() {
  positionSeq = 0;
  const yesterday = moscowDate(-1);
  const today = moscowDate(0);
  const nextWeek = moscowDate(7);

  const projects = [
    ...PROJECT_SEEDS.map((seed) => projectDto(seed)),
    projectDto(
      { id: INBOX_ID, name: 'Входящие', icon: null, description: null },
      { isInbox: true, memberCount: 1 },
    ),
  ];

  const tasks = [
    // Assigned to me, in projects — the «Очередь» of «Входящие».
    taskDto({ id: 't-home', projectId: 'p-site', title: 'Обновить главную страницу клиники', body: 'Новый первый экран и блок акций.', status: 'backlog', deadline: yesterday, priority: 2, createdHoursAgo: 120 }),
    taskDto({ id: 't-pay', projectId: 'p-shop', title: 'Настроить оплату картой', body: 'Подключить эквайринг и проверить возвраты.', status: 'todo', deadline: today, priority: 1, createdHoursAgo: 96 }),
    taskDto({ id: 't-crm-export', projectId: 'p-crm', title: 'Выгрузить контакты из CRM', status: 'backlog', deadline: nextWeek, priority: 3, createdHoursAgo: 72 }),
    taskDto({ id: 't-ios', projectId: 'p-mobile', title: 'Собрать тестовую сборку для iOS', status: 'backlog', taskType: 'feature', createdHoursAgo: 60 }),
    taskDto({ id: 't-release-doc', projectId: 'p-docs', title: 'Описать процесс релиза', status: 'backlog', priority: 4, createdHoursAgo: 30 }),
    taskDto({ id: 't-delivery', projectId: 'p-shop', title: 'Подключить службу доставки', status: 'done', createdHoursAgo: 200 }),
    // Assigned to me, status manual — the «Вручную» shelf of «Сейчас».
    taskDto({ id: 't-form', projectId: 'p-site', title: 'Поправить форму записи к врачу', status: 'manual', deadline: today, priority: 2, createdHoursAgo: 50 }),
    // My personal inbox.
    taskDto({ id: 't-domain', projectId: INBOX_ID, title: 'Продлить домен для лендинга', status: 'backlog', deadline: nextWeek, createdHoursAgo: 20 }),
    // Assigned to colleagues — «На утверждении» from other people and the «Для всех» tab.
    taskDto({ id: 't-doctors', projectId: 'p-site', title: 'Сверстать страницу врачей', body: 'Карточки врачей с фильтром по специальности.', status: 'pending_approval', assignee: 'u-boris', deadline: today, createdHoursAgo: 80 }),
    taskDto({ id: 't-brands', projectId: 'p-shop', title: 'Добавить фильтр по брендам', status: 'pending_approval', assignee: 'u-vera', createdHoursAgo: 70 }),
    taskDto({ id: 't-webhooks', projectId: 'p-crm', title: 'Настроить вебхуки CRM', status: 'todo', assignee: 'u-gleb', deadline: nextWeek, createdHoursAgo: 40 }),
    taskDto({ id: 't-profile-screen', projectId: 'p-mobile', title: 'Экран профиля пользователя', status: 'in_progress', assignee: 'u-boris', createdHoursAgo: 35 }),
    taskDto({ id: 't-prices', projectId: 'p-site', title: 'Обновить прайс-лист', status: 'backlog', assignee: 'u-vera', deadline: yesterday, createdHoursAgo: 90 }),
    // A colleague's personal inbox task (visible on «Для всех», read-only).
    taskDto({ id: 't-vera-report', projectId: VERA_INBOX_ID, title: 'Подготовить отчёт за неделю', status: 'backlog', assignee: 'u-vera', creator: 'u-vera', createdHoursAgo: 10 }),
  ];

  for (const p of projects) p.taskCount = tasks.filter((t) => t.projectId === p.id).length;

  const views = Object.fromEntries(
    PROJECT_SEEDS.map((seed) => [
      seed.id,
      [
        {
          id: `view-${seed.id}-board`,
          projectId: seed.id,
          name: 'Доска',
          type: 'kanban',
          sortOrder: 0,
          config: null,
          createdAt: '2025-03-01T10:00:00.000Z',
        },
      ],
    ]),
  );

  return {
    user: { ...ME },
    projects,
    tasks,
    views,
    uiPrefs: { inboxAssignedGrouping: 'project' },
    today,
  };
}

// --- Read models --------------------------------------------------------------

const isInboxProject = (state, projectId) =>
  projectId === VERA_INBOX_ID || state.projects.some((p) => p.id === projectId && p.isInbox);

function projectNameOf(state, projectId) {
  if (projectId === VERA_INBOX_ID) return 'Входящие';
  return state.projects.find((p) => p.id === projectId)?.name ?? 'Проект';
}

function assignedItem(state, task) {
  const inbox = isInboxProject(state, task.projectId);
  const ownerId = task.projectId === VERA_INBOX_ID ? 'u-vera' : ME.id;
  return {
    task,
    projectId: task.projectId,
    projectName: projectNameOf(state, task.projectId),
    isInbox: inbox,
    canModify: task.projectId !== VERA_INBOX_ID,
    inboxOwner: inbox ? { userId: ownerId, displayName: person(ownerId).displayName } : null,
  };
}

function workspaceDto() {
  return {
    id: WORKSPACE_ID,
    name: 'Команда «Смоук»',
    icon: '🧪',
    kind: 'team',
    requireTaskApproval: true,
    workerEnabled: true,
    commitSyncMode: 'propose',
    ownerUserId: ME.id,
    role: 'owner',
    projectCount: PROJECT_SEEDS.length,
    memberCount: PEOPLE.length,
    isCurrent: true,
    createdAt: '2025-01-15T09:00:00.000Z',
  };
}

const usageWindow = (label) => ({
  label,
  spentUsd: 0.42,
  capUsd: null,
  remainingUsd: null,
  isOver: false,
  resetsAt: null,
});

function usageDto() {
  return {
    plan: 'vip',
    subscription: { plan: 'vip', startedAt: null, expiresAt: null },
    windows: { fiveHour: usageWindow('5h'), sevenDay: usageWindow('7d') },
    isBlocked: false,
    blockedWindow: null,
    rubPerUsd: 90,
    primeTrialAvailable: false,
    isAdmin: true,
  };
}

const sharedMember = (p) => ({ id: p.id, displayName: p.displayName, email: p.email, avatarUrl: p.avatarUrl });

function projectMemberDto(projectId, p, role) {
  return {
    projectId,
    userId: p.id,
    role,
    joinedAt: '2025-03-02T10:00:00.000Z',
    user: { id: p.id, email: p.email, displayName: p.displayName, avatarUrl: p.avatarUrl },
  };
}

const NOTIFICATION_PREFS = {};

// --- Router ----------------------------------------------------------------------

const json = (body, status = 200) => ({ status, body });
const noContent = () => ({ status: 204, body: null });

// GET handlers: [pattern, (match, ctx) => response | undefined]. Order matters.
function getRoutes(state, workspaceId = WORKSPACE_ID) {
  const scopedProjects = () => state.projects.filter((p) => p.workspaceId === workspaceId);
  const scopedTasks = () => state.tasks.filter((t) => (state.projects.find((p) => p.id === t.projectId)?.workspaceId ?? WORKSPACE_ID) === workspaceId);
  const scopedMembers = () => state.membersByWorkspace?.[workspaceId] ?? COLLEAGUES;

  const projectById = (id) => state.projects.find((p) => p.id === id);
  return [
    [/^\/auth\/me$/, () => json({ user: state.user })],
    [/^\/auth\/me\/usage$/, () => json(usageDto())],
    [/^\/workspaces$/, () => json({ workspaces: (state.workspaces ?? [workspaceDto()]).map((w) => ({ ...w, isCurrent: w.id === (state.activeWorkspaceId ?? WORKSPACE_ID) })) })],
    [/^\/workspaces\/chat\/rooms$/, () =>
      json({
        rooms: [
          {
            workspaceId: WORKSPACE_ID,
            name: workspaceDto().name,
            kind: 'team',
            ownerUserId: ME.id,
            role: 'owner',
            memberCount: PEOPLE.length,
            unreadCount: 0,
            lastMessageSeq: 0,
          },
        ],
      })],
    [/^\/workspaces\/([^/]+)\/members$/, () =>
      json({
        members: PEOPLE.map((p, i) => ({
          userId: p.id,
          role: i === 0 ? 'owner' : i === 1 ? 'lead' : 'editor',
          displayName: p.displayName,
          email: p.email,
          avatarUrl: p.avatarUrl,
        })),
      })],
    [/^\/workspaces\/([^/]+)\/invites$/, () => json({ invites: [] })],
    [/^\/workspaces\/([^/]+)\/projects$/, () =>
      json({ projects: PROJECT_SEEDS.map((s) => ({ id: s.id, name: s.name, icon: s.icon })) })],
    [/^\/workspaces\/([^/]+)\/kanban-columns$/, () => json({ columns: [] })],
    [/^\/workspaces\/([^/]+)\/commit-sync\/projects$/, () =>
      json({
        projects: PROJECT_SEEDS.map((s) => ({ id: s.id, name: s.name, icon: s.icon, commitSyncEnabled: false })),
      })],
    [/^\/workspaces\/([^/]+)\/assignee-digest\/groups$/, () => json({ groups: [] })],
    [/^\/workspaces\/([^/]+)\/assignee-digest$/, ([, id]) =>
      json({
        settings: {
          workspaceId: id,
          enabled: false,
          personalEnabled: false,
          hour: 10,
          minute: 0,
          daysOfWeek: [1, 2, 3, 4, 5],
          telegramGroupChatId: null,
          telegramGroupTitle: null,
          recipientMode: 'all',
          recipientUserIds: [],
          projectMode: 'all',
          projectIds: [],
          commitSyncEnabled: false,
          commitSyncHour: 18,
          commitSyncMinute: 0,
          commitSyncAction: 'propose',
          commitSyncLastSentOn: null,
          eodReminderEnabled: false,
          eodReminderHour: 19,
          eodReminderMinute: 0,
          eodReminderLastSentOn: null,
          lastSentOn: null,
        },
        members: PEOPLE.map((p) => ({
          userId: p.id,
          displayName: p.displayName,
          email: p.email,
          avatarUrl: p.avatarUrl,
          telegramUsername: null,
          hasTelegram: false,
        })),
      })],
    [/^\/workspaces\/([^/]+)\/project-access$/, () =>
      json({
        projects: PROJECT_SEEDS.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
        members: PEOPLE.map((p) => ({ userId: p.id, hiddenProjectIds: [] })),
      })],
    [/^\/workspaces\/([^/]+)\/chat\/unread$/, () => json({ count: 0 })],
    [/^\/workspaces\/([^/]+)\/chat\/participants$/, () =>
      json({ participants: PEOPLE.map((p) => ({ userId: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl })) })],
    [/^\/workspaces\/([^/]+)\/chat\/messages$/, () => json({ messages: [] })],
    [/^\/workspaces\/([^/]+)\/feed$/, () => json({ items: state.feed ?? [], nextBefore: null })],

    [/^\/projects$/, () => json({ projects: scopedProjects() })],
    [/^\/inbox$/, () => json({ project: scopedProjects().find((p) => p.isInbox && p.ownerId === ME.id) })],
    [/^\/projects\/([^/]+)$/, ([, id]) => {
      const project = projectById(id);
      return project ? json({ project }) : json({ error: 'not_found' }, 404);
    }],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)$/, ([, projectId, taskId]) => {
      const task = state.tasks.find((t) => t.id === taskId && t.projectId === projectId);
      return task ? json({ task: { canTransferProject: true, ...task } }) : json({ error: 'not_found' }, 404);
    }],
    [/^\/projects\/([^/]+)\/tasks$/, ([, id]) =>
      json({ tasks: state.tasks.filter((t) => t.projectId === id) })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/comments$/, () => json({ comments: [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/attachments$/, () => json({ attachments: [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/commits$/, () => json({ commits: [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/versions$/, ([, , taskId]) =>
      json({ plan: 'vip', cutoffAt: null, versions: [], taskId })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/live\/sessions$/, () => json({ sessions: [] })],
    [/^\/projects\/([^/]+)\/members$/, ([, id]) => {
      if (isInboxProject(state, id)) return json({ members: [projectMemberDto(id, ME, 'owner')] });
      return json({
        members: PEOPLE.map((p, i) => projectMemberDto(id, p, i === 0 ? 'owner' : 'editor')),
      });
    }],
    [/^\/projects\/([^/]+)\/views$/, ([, id]) => json({ views: state.views[id] ?? [] })],
    [/^\/projects\/([^/]+)\/properties$/, () => json({ properties: [], values: [] })],
    [/^\/projects\/([^/]+)\/templates$/, () => json({ templates: [] })],
    [/^\/projects\/([^/]+)\/kanban-settings$/, () => json({ settings: {} })],
    [/^\/projects\/([^/]+)\/notification-prefs$/, () => json({ prefs: NOTIFICATION_PREFS })],
    [/^\/projects\/([^/]+)\/activity$/, ([, id]) =>
      json({
        summary: {
          createdAt: projectById(id)?.createdAt ?? '2025-03-01T10:00:00.000Z',
          createdByName: ME.displayName,
          lastEditedAt: hoursAgo(3),
          lastEditedByName: ME.displayName,
        },
        items: [],
        hasMore: false,
        nextCursor: null,
      })],
    [/^\/projects\/([^/]+)\/finance\/summary$/, () =>
      json({
        finance: {
          laborTotalKopecks: 0,
          labor: [],
          otherExpensesTotalKopecks: 0,
          expenses: [],
          incomeTotalKopecks: 0,
          incomes: [],
          expenseTotalKopecks: 0,
          profitKopecks: 0,
          marginPercent: null,
        },
      })],
    [/^\/projects\/([^/]+)\/monitoring\/servers$/, () => json({ servers: [] })],
    [/^\/projects\/([^/]+)\/monitoring\/alerts$/, () => json({ alerts: [] })],
    [/^\/projects\/([^/]+)\/site$/, () =>
      json({ siteSlug: null, deployedAt: null, fileCount: 0, routes: [], runtime: null })],
    [/^\/projects\/([^/]+)\/dispatcher-candidates$/, () =>
      json({
        candidates: PEOPLE.map((p, i) => ({
          userId: p.id,
          displayName: p.displayName,
          email: p.email,
          role: i === 0 ? 'owner' : 'editor',
          activeTokenCount: 0,
          isAdmin: i === 0,
          isMember: true,
        })),
      })],
    [/^\/projects\/([^/]+)\/git-token-delegation$/, () =>
      json({ mine: { enabled: false, grantedAt: null, revokedAt: null }, all: [] })],

    [/^\/me\/shared-members$/, () => json({ members: scopedMembers().map(sharedMember) })],
    [/^\/me\/ui-prefs$/, () => json({ prefs: state.uiPrefs })],
    [/^\/me\/kanban-colors$/, () => json({ colors: {} })],
    [/^\/me\/notification-prefs$/, () => json({ prefs: NOTIFICATION_PREFS })],
    [/^\/me\/unread-tasks$/, () => json({ taskIds: [] })],
    [/^\/me\/stats\/completed-today$/, () => json({ count: state.completedByWorkspace?.[workspaceId] ?? 2 })],
    [/^\/me\/stats\/completed-by-workspace$/, () => json({ workspaces: [] })],

    [/^\/assignees\/mine$/, () =>
      json({
        items: scopedTasks()
          .filter((t) => t.assignee.userId === ME.id && !isInboxProject(state, t.projectId))
          .map((t) => assignedItem(state, t)),
      })],
    [/^\/assignees\/others$/, () =>
      json({
        items: scopedTasks()
          .filter((t) => t.assignee.userId !== ME.id && !isInboxProject(state, t.projectId))
          .map((t) => assignedItem(state, t)),
      })],
    [/^\/assignees\/personal$/, () =>
      json({
        items: scopedTasks()
          .filter((t) => t.projectId === VERA_INBOX_ID)
          .map((t) => assignedItem(state, t)),
      })],
    [/^\/assignees\/member\/([^/]+)$/, ([, memberId]) =>
      json({
        items: scopedTasks()
          .filter((t) => t.assignee.userId === decodeURIComponent(memberId) && t.status !== 'done')
          .map((t) => assignedItem(state, t)),
      })],

    [/^\/notifications$/, () => json({ notifications: [] })],
    [/^\/notifications\/unread-count$/, () => json({ count: 0 })],
    [/^\/recent-task-views$/, () => json({ recent: [] })],
    [/^\/integrations\/github\/me$/, () => json({ connection: null })],
    [/^\/me\/telegram$/, () =>
      json({
        connected: false,
        telegramUsername: null,
        telegramFirstName: null,
        telegramPhotoUrl: null,
        tgStarted: false,
        prefs: {
          commentOnMyTask: true,
          mention: true,
          statusChange: true,
          teamStatusChange: false,
          ralphQuestion: true,
          ralphAnswer: true,
          taskDone: true,
        },
        botUsername: null,
        botDeepLink: null,
        botId: null,
      })],
    [/^\/employees$/, () => json({ employees: [] })],
    [/^\/agent\/tokens$/, () => json({ tokens: [] })],
    [/^\/ai\/conversations$/, () => json({ items: [], nextCursor: null })],
  ];
}

function parseBody(request) {
  try {
    return request.postDataJSON() ?? null;
  } catch {
    return request.postData() ?? null;
  }
}

// Mutations: journaled, then answered like the server would (where a scenario relies on it).
function mutate(state, method, path, body) {
  const taskMatch = path.match(/^\/projects\/([^/]+)\/tasks\/([^/]+)(\/.*)?$/);
  if (taskMatch) {
    const [, , taskId, rest = ''] = taskMatch;
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return json({ error: 'not_found' }, 404);
    const touch = (patch) => {
      Object.assign(task, patch, { updatedAt: new Date().toISOString() });
      return json({ task });
    };
    if (method === 'POST' && rest === '/move') {
      const target = body?.restore ? task.statusBeforeDone ?? 'backlog' : body?.targetStatus;
      if (!target) return json({ error: 'validation_error' }, 400);
      return touch({
        status: target,
        statusBeforeDone: target === 'done' ? task.status : null,
      });
    }
    if (method === 'PATCH' && rest === '') return touch(body ?? {});
    if (method === 'DELETE' && rest === '') {
      state.tasks = state.tasks.filter((t) => t.id !== taskId);
      return noContent();
    }
    if (method === 'PUT' && rest === '/assignee') {
      return touch({ assignee: assigneeRef(body?.assigneeUserId ?? ME.id) });
    }
    if (method === 'POST' && rest === '/approval/reject') {
      const res = touch({ status: 'in_progress' });
      return json({ task: res.body.task, commentId: `c-${Date.now()}` });
    }
    if (method === 'POST' && rest === '/approval/withdraw') return touch({ status: 'manual' });
    if (method === 'POST' && rest === '/assign-to-project') {
      return touch({ projectId: body?.targetProjectId ?? task.projectId, context: undefined });
    }
  }

  const createTask = path.match(/^\/projects\/([^/]+)\/tasks$/);
  if (createTask && method === 'POST') {
    const created = taskDto({
      id: `t-new-${state.tasks.length + 1}`,
      projectId: createTask[1],
      title: String(body?.description ?? 'Новая задача'),
      status: body?.status ?? 'backlog',
      assignee: body?.assigneeUserId ?? ME.id,
      deadline: body?.deadline ?? null,
      priority: body?.priority ?? null,
      createdHoursAgo: 0,
    });
    state.tasks.push(created);
    return json({ task: created }, 201);
  }

  // POST /projects/:id/views is shared by «record a project visit» ({}) and «create a view».
  const viewsMatch = path.match(/^\/projects\/([^/]+)\/views$/);
  if (viewsMatch && method === 'POST') {
    if (!body?.name) return noContent();
    const view = {
      id: `view-new-${Date.now()}`,
      projectId: viewsMatch[1],
      name: body.name,
      type: body.type ?? 'kanban',
      sortOrder: (state.views[viewsMatch[1]] ?? []).length,
      config: null,
      createdAt: new Date().toISOString(),
    };
    (state.views[viewsMatch[1]] ??= []).push(view);
    return json({ view }, 201);
  }

  if (method === 'PUT' && path === '/me/ui-prefs') {
    state.uiPrefs = { ...state.uiPrefs, ...(body?.prefs ?? {}) };
    return json({ prefs: state.uiPrefs });
  }
  if (method === 'PUT' && path === '/me/kanban-colors') return json({ colors: body?.colors ?? {} });
  if (method === 'POST' && /^\/notifications\/[^/]+\/read$/.test(path)) return noContent();
  if (method === 'POST' && path === '/recent-task-views') return noContent();
  if (method === 'PUT' && path === '/workspaces/current') { state.activeWorkspaceId = body.workspaceId; return noContent(); }
  if (method === 'POST' && path === '/auth/logout') return noContent();
  if (method === 'POST' && path === '/telemetry/actions') return noContent();
  return undefined;
}

const STREAM_PATH = /\/stream(\/|$)/;

/**
 * Creates the API router for one browser context.
 * @param {{ authenticated?: boolean }} options
 */
export function createApiRouter({ authenticated = true } = {}) {
  const state = createState();
  const journal = {
    // { method, path, body } of every POST/PATCH/PUT/DELETE, in order.
    mutations: [],
    // `METHOD /api/path` that the router does not know (answered with {} / {ok:true}).
    unknown: [],
    // Aborted SSE/stream requests.
    streams: [],
    streamWorkspaces: [],
    expectedErrors: [],
    // Exceptions inside the router itself (a bug in the fixtures, not in the app).
    routerErrors: [],
  };
  function resolveGet(path, workspaceId) {
    for (const [pattern, handler] of getRoutes(state, workspaceId)) {
      const match = path.match(pattern);
      if (!match) continue;
      const res = handler(match);
      if (res) return res;
    }
    return undefined;
  }

  async function fulfill(route, res) {
    if (res.status === 204) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({
      status: res.status,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(res.body),
    });
  }

  // A bug in a handler must not leave the request hanging: answer 500 and journal it.
  async function handle(route) {
    try {
      return await dispatch(route);
    } catch (error) {
      journal.routerErrors.push(`${route.request().method()} ${route.request().url()}: ${error.message}`);
      return route
        .fulfill({ status: 500, contentType: 'application/json', body: '{"error":"smoke_router_error"}' })
        .catch(() => {});
    }
  }

  async function dispatch(route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = request.method();
    const workspaceId = request.headers()['x-workspace-id'] ?? state.activeWorkspaceId ?? WORKSPACE_ID;
    journal.reads ??= [];
    if (method === 'GET') journal.reads.push({ path, workspaceId });

    if (request.resourceType() === 'eventsource' || STREAM_PATH.test(path)) {
      journal.streams.push(path);
      journal.streamWorkspaces.push(url.searchParams.get('workspaceId'));
      return route.abort('aborted');
    }

    if (!authenticated) {
      return fulfill(route, json({ error: 'unauthorized' }, 401));
    }

    if (method === 'GET' || method === 'HEAD') {
      const failure = state.failReads?.[`${workspaceId}:${path}`];
      if (failure) {
        journal.expectedErrors.push({ url: request.url(), status: failure.status });
        return fulfill(route, json({ error: failure.error }, failure.status));
      }
      const res = resolveGet(path, workspaceId);
      const delay = state.delays?.[`${workspaceId}:${path}`] ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (res) return fulfill(route, res);
      journal.unknown.push(`GET /api${path}`);
      return fulfill(route, json({}));
    }

    const body = parseBody(request);
    journal.mutations.push({ method, path, body });
    if (path === '/workspaces/current') {
      if (state.switchDelay) await new Promise((resolve) => setTimeout(resolve, state.switchDelay));
      if (state.failNextSwitch) {
        state.failNextSwitch = false;
        journal.expectedErrors.push({ url: request.url(), status: 409 });
        return fulfill(route, json({ error: 'switch_failed' }, 409));
      }
    }
    const res = mutate(state, method, path, body);
    if (res) return fulfill(route, res);
    journal.unknown.push(`${method} /api${path}`);
    return fulfill(route, json({ ok: true }));
  }

  return { handle, journal, state };
}

// Helpers for scenarios: titles and expectations derived from the same fixture data.
export const firstLine = (task) => task.description.split('\n')[0];

// Extra workspaces exist only in isolation scenarios; ordinary scenarios retain their
// single-space data. The same user belongs to both teams, with different colleagues.
export function addIsolationWorkspaces(state) {
  state.workspaces = [workspaceDto(),
    { ...workspaceDto(), id: 'ws-other', name: 'Другая команда', isCurrent: false },
    { ...workspaceDto(), id: 'ws-personal', name: 'Личное пространство', kind: 'default', isCurrent: false },
  ];
  state.membersByWorkspace = { [WORKSPACE_ID]: COLLEAGUES, 'ws-other': [COLLEAGUES[2]], 'ws-personal': [] };
  state.completedByWorkspace = { [WORKSPACE_ID]: 2, 'ws-other': 7, 'ws-personal': 0 };
  for (const ws of ['ws-other', 'ws-personal']) {
    state.projects.push(projectDto({ id: `inbox-${ws}`, name: `Входящие ${ws}` }, { isInbox: true, workspaceId: ws }));
    state.projects.push(projectDto({ id: `project-${ws}`, name: ws === 'ws-other' ? 'Дизайн второй команды' : 'Мой личный проект' }, { workspaceId: ws }));
    state.tasks.push(taskDto({ id: `manual-${ws}`, projectId: `inbox-${ws}`, title: `Работа ${ws}`, status: 'manual', deadline: moscowDate(-1) }));
    state.tasks.push(taskDto({ id: `queue-${ws}`, projectId: `project-${ws}`, title: `Очередь ${ws}`, status: 'backlog', deadline: moscowDate(-1) }));
  }
}
