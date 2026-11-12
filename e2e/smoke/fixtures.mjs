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
// 1×1 PNG for uploaded comment images.
export const SMOKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SMOKE_PNG_DATA_URL = `data:image/png;base64,${SMOKE_PNG_BASE64}`;
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
    // Assigned to me, status manual — the «В работе» shelf of «Сейчас».
    taskDto({ id: 't-form', projectId: 'p-site', title: 'Поправить форму записи к врачу', status: 'manual', deadline: today, priority: 2, createdHoursAgo: 50 }),
    // My personal inbox.
    taskDto({ id: 't-domain', projectId: INBOX_ID, title: 'Продлить домен для лендинга', status: 'backlog', deadline: nextWeek, createdHoursAgo: 20 }),
    // Assigned to colleagues — «На утверждении» from other people and the «Все» tab.
    taskDto({ id: 't-doctors', projectId: 'p-site', title: 'Сверстать страницу врачей', body: 'Карточки врачей с фильтром по специальности.', status: 'pending_approval', assignee: 'u-boris', deadline: today, createdHoursAgo: 80 }),
    taskDto({ id: 't-brands', projectId: 'p-shop', title: 'Добавить фильтр по брендам', status: 'pending_approval', assignee: 'u-vera', createdHoursAgo: 70 }),
    taskDto({ id: 't-webhooks', projectId: 'p-crm', title: 'Настроить вебхуки CRM', status: 'todo', assignee: 'u-gleb', deadline: nextWeek, createdHoursAgo: 40 }),
    taskDto({ id: 't-profile-screen', projectId: 'p-mobile', title: 'Экран профиля пользователя', status: 'in_progress', assignee: 'u-boris', createdHoursAgo: 35 }),
    taskDto({ id: 't-prices', projectId: 'p-site', title: 'Обновить прайс-лист', status: 'backlog', assignee: 'u-vera', deadline: yesterday, createdHoursAgo: 90 }),
    // A colleague's personal inbox task (visible on «Все», read-only).
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
  const ownerId = task.projectId === VERA_INBOX_ID
    ? 'u-vera'
    : state.projects.find((p) => p.id === task.projectId)?.ownerId ?? ME.id;
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
const ACTIONABLE_NOTIFICATIONS = ['workspace_invite', 'project_invite', 'join_request'];
// «Для меня» (?mine=1): личные виды всегда, о задачах — у которых в фикстуре стоит forMe
// (на сервере это «я исполнитель или автор задачи»).
const MINE_NOTIFICATIONS = [...ACTIONABLE_NOTIFICATIONS, 'comment_mention', 'chat_mention', 'task_assignee_changed'];
const isMineNotification = (n) => MINE_NOTIFICATIONS.includes(n.payload.type) || n.forMe === true;

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
    // Рабочие Telegram-группы (db/181) и кандидаты «Из соседних пространств».
    [/^\/workspaces\/([^/]+)\/telegram-groups$/, () =>
      json({
        groups: [{ chatId: -1001234567890, title: 'Команда · задачи', createdAt: '2026-11-01T09:00:00.000Z' }],
        mainGroup: null,
        botUsername: 'ProjectsFlow_Bot',
      })],
    [/^\/workspaces\/([^/]+)\/invite-candidates$/, () =>
      json({
        candidates: PEOPLE.slice(0, 2).map((p) => ({
          userId: `${p.id}-neighbor`,
          displayName: p.displayName,
          email: `neighbor.${p.email}`,
          avatarUrl: null,
          hasTelegram: true,
          workspaces: [{ id: 'ws-office', name: 'Офис', icon: null }],
          invited: false,
        })),
      })],
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
          urgentRemindersEnabled: true,
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
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/comments$/, ([, , taskId]) => json({ comments: state.comments?.[taskId] ?? [] })],
    // Who the comment author may notify; the server marks the manager as the default.
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/comment-notify-candidates$/, () => json({
      candidates: state.notifyCandidates ?? COLLEAGUES.map((p) => ({
        userId: p.id, displayName: p.displayName, avatarUrl: p.avatarUrl,
        isDefault: p.id === 'u-boris', isManager: p.id === 'u-boris',
      })),
    })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/attachments$/, () => json({ attachments: [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/commits$/, () => json({ commits: [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/versions$/, ([, , taskId]) =>
      json({ plan: 'vip', cutoffAt: null, versions: [], taskId })],
    [/^\/projects\/([^/]+)\/live\/activity$/, ([, projectId]) => {
      const latest = new Map();
      for (const session of Object.values(state.liveSessions ?? {}).flat().filter(s => s.projectId === projectId)) {
        const previous = latest.get(session.taskId);
        if (!previous || new Date(session.startedAt) >= new Date(previous.startedAt)) latest.set(session.taskId, session);
      }
      return json({ activities: [...latest.values()].filter(s => ['running','failed','timeout'].includes(s.status))
        .map(s => ({ taskId:s.taskId,state:s.status==='running'?'running':'error',sessionId:s.id,questionCommentId:null })) });
    }],
    [/^\/projects\/([^/]+)\/live\/running$/, ([, projectId]) => json({ taskIds: Object.values(state.liveSessions ?? {}).flat().filter(s => s.projectId === projectId && s.status === 'running').map(s => s.taskId) })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/live\/sessions$/, ([, , taskId]) => json({ sessions: state.liveSessions?.[taskId] ?? [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/live\/sessions\/([^/]+)\/events$/, ([, , , sessionId]) => json({ events: state.liveEvents?.[sessionId] ?? [] })],
    [/^\/projects\/([^/]+)\/tasks\/([^/]+)\/live\/sessions\/([^/]+)\/file-diffs$/, () => json({ files: [] })],
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
    // Вопросы мне без ответа: state.awaitingReply = [{ taskId, authorUserId, excerpt }].
    [/^\/assignees\/awaiting-reply$/, () =>
      json({
        items: (state.awaitingReply ?? []).flatMap((q) => {
          const task = scopedTasks().find((t) => t.id === q.taskId);
          if (!task) return [];
          return [{
            ...assignedItem(state, task),
            question: {
              commentId: `c-${q.taskId}`,
              authorUserId: q.authorUserId,
              authorDisplayName: person(q.authorUserId).displayName,
              excerpt: q.excerpt,
              askedAt: new Date().toISOString(),
            },
          }];
        }),
      })],
    // Очередь приёмки руководителя: всё «На утверждении» пространства (ME — владелец).
    [/^\/assignees\/approvals$/, () => {
      const workspace = (state.workspaces ?? [workspaceDto()]).find((w) => w.id === workspaceId);
      const approver = workspace?.role === 'owner' || workspace?.role === 'lead';
      return json({
        items: approver
          ? scopedTasks().filter((t) => t.status === 'pending_approval').map((t) => assignedItem(state, t))
          : [],
      });
    }],
    [/^\/assignees\/member\/([^/]+)$/, ([, memberId]) =>
      json({
        items: scopedTasks()
          .filter((t) => t.assignee.userId === decodeURIComponent(memberId) && t.status !== 'done')
          .map((t) => assignedItem(state, t)),
      })],

    [/^\/notifications$/, (_match, query) => json({
      notifications: (state.notifications ?? []).filter((n) =>
        (query.get('unread') !== '1' || !n.readAt) &&
        (query.get('actionable') !== '1' || ACTIONABLE_NOTIFICATIONS.includes(n.payload.type)) &&
        (query.get('mine') !== '1' || isMineNotification(n))),
    })],
    // since — бейдж колокольчика: новые после прошлого открытия + неотвеченные приглашения.
    [/^\/notifications\/unread-count$/, (_match, query) => {
      const since = query.get('since') ? new Date(query.get('since')) : null;
      return json({
        count: (state.notifications ?? []).filter((n) => !n.readAt &&
          (query.get('mine') !== '1' || isMineNotification(n)) &&
          (!since || new Date(n.createdAt) > since || ACTIONABLE_NOTIFICATIONS.includes(n.payload.type))).length,
      });
    }],
    [/^\/recent-task-views$/, () => json({ recent: [] })],
    [/^\/integrations\/github\/me$/, () => json({ connection: null })],
    [/^\/me\/telegram$/, () =>
      json(state.telegramStatus ?? {
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
    // Admin «Рассылки»: template library, audience options and campaign history.
    [/^\/admin\/mailings\/templates$/, () => json({ templates: mailingState(state).templates, starters: MAILING_STARTERS })],
    [/^\/admin\/mailings\/audience\/workspaces$/, () => json({ workspaces: [{ id: WORKSPACE_ID, name: workspaceDto().name, memberCount: PEOPLE.length }] })],
    [/^\/admin\/mailings\/campaigns$/, () => json({ campaigns: mailingState(state).campaigns })],
    // Admin «Пользователи»: the list and the deletion summary of the confirm dialog.
    [/^\/admin\/users$/, (_m, query) => json(adminUsersPage(state, query))],
    [/^\/admin\/users\/([^/]+)\/deletion-preview$/, (m) => json(adminDeletionPreview(state, m[1]))],
    [/^\/admin\/users\/([^/]+)\/overview$/, (m) => adminUserOverview(state, m[1])],
  ];
}

// --- Admin users ------------------------------------------------------------------

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

function adminUsersState(state) {
  state.adminUsers ??= { users: PEOPLE.map((p, i) => ({
    id: p.id, email: p.email, displayName: p.displayName, avatarUrl: null,
    // Глеб is another admin: his deletion stays blocked until the rights are removed.
    isAdmin: p.id === ME.id || p.id === 'u-gleb', projectCount: 3 - Math.min(i, 2), ownedProjectCount: i === 0 ? 2 : 0,
    delegationEnabledCount: 0, githubConnected: false,
    plan: p.id === 'u-boris' ? 'prime' : 'free', subscriptionExpiresAt: p.id === 'u-boris' ? inDays(5) : null,
    telegramLinked: p.id === 'u-vera', telegramUsername: p.id === 'u-vera' ? 'vera_l' : null,
    workspaceCount: 1 + (i === 0 ? 1 : 0), lastLoginAt: inDays(-i - 1),
    // Глеб has not been seen for two months: he is the «Неактивные» example.
    lastActivityAt: p.id === 'u-gleb' ? inDays(-60) : inDays(-i * 0.01),
    createdAt: `2025-0${i + 1}-01T09:00:00.000Z`, deletedAt: null,
  })), history: {} };
  return state.adminUsers;
}

// Mirror of the server rules (domain/user/adminUserDirectory.ts) for the smoke data.
const ADMIN_FILTERS = ['all', 'free', 'prime', 'vip', 'expired', 'admins', 'telegram', 'inactive', 'deleted'];
function adminPlanState(u) {
  if (u.plan === 'free') return 'free';
  return u.subscriptionExpiresAt && Date.parse(u.subscriptionExpiresAt) <= Date.now() ? 'expired' : u.plan;
}
function adminMatches(u, filter, idleDays) {
  if (filter === 'deleted') return Boolean(u.deletedAt);
  if (u.deletedAt) return false;
  if (filter === 'all') return true;
  if (['free', 'prime', 'vip', 'expired'].includes(filter)) return adminPlanState(u) === filter;
  if (filter === 'admins') return u.isAdmin;
  if (filter === 'telegram') return u.telegramLinked;
  return !u.lastActivityAt || Date.parse(u.lastActivityAt) < Date.now() - idleDays * 86400000;
}
function adminUsersPage(state, query) {
  const q = (query.get('q') ?? '').trim().toLowerCase().replace(/^@/, '');
  const filter = ADMIN_FILTERS.includes(query.get('filter')) ? query.get('filter') : 'all';
  const idle = Number(query.get('inactiveDays')) || 30;
  const pageSize = Number(query.get('pageSize')) || 50;
  const page = Number(query.get('page')) || 1;
  const searched = adminUsersState(state).users.filter((u) => !q
    || [u.displayName, u.email, u.telegramUsername ?? ''].some((v) => v.toLowerCase().includes(q)));
  const counts = Object.fromEntries(ADMIN_FILTERS.map((f) => [f, searched.filter((u) => adminMatches(u, f, idle)).length]));
  const sort = query.get('sort') ?? 'created';
  const sign = query.get('dir') === 'asc' ? 1 : -1;
  const key = (u) => sort === 'name' ? u.displayName : sort === 'activity' ? u.lastActivityAt ?? '' : sort === 'expiry' ? u.subscriptionExpiresAt ?? '~' : u.createdAt;
  const list = searched.filter((u) => adminMatches(u, filter, idle)).sort((a, b) => key(a).localeCompare(key(b), 'ru') * sign);
  return { users: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize, counts };
}
function adminUserOverview(state, id) {
  const a = adminUsersState(state);
  const user = a.users.find((u) => u.id === id);
  if (!user) return json({ error: 'user_not_found', message: 'Пользователь не найден' }, 404);
  return json({
    user,
    workspaces: [{ id: WORKSPACE_ID, name: workspaceDto().name, kind: 'team', role: user.isAdmin ? 'owner' : 'editor', isOwner: user.id === ME.id, memberCount: PEOPLE.length }],
    projects: [{ id: 'p-site', name: 'Сайт клиники', status: 'active', role: 'editor', workspaceName: workspaceDto().name, taskCount: 12 }],
    usage: { costUsd30d: 3.42, costUsdTotal: 18.9, runs30d: 14 },
    activity: { tasksCreated30d: 9, comments30d: 21, activeSessions: 2, lastLoginAt: user.lastLoginAt, lastSeenAt: user.lastActivityAt },
    history: a.history[id] ?? [],
  });
}
function adminJournal(state, id, action, before, after) {
  const a = adminUsersState(state);
  (a.history[id] ??= []).unshift({ id: `h-${Date.now()}-${Math.random()}`, actorUserId: ME.id, actorDisplayName: ME.displayName,
    action, batchId: null, before, after, createdAt: new Date().toISOString() });
}

function adminDeletionPreview(state, id) {
  const user = adminUsersState(state).users.find((u) => u.id === id);
  const blockers = [...(id === ME.id ? [{ kind: 'self' }] : []), ...(user?.isAdmin ? [{ kind: 'admin' }] : [])];
  return { blockers, removedWorkspaces: [{ name: 'Личное пространство', kind: 'default' }], removedProjects: 2, removedTasks: 7,
    reassignedTasks: 3, leftWorkspaces: [{ name: workspaceDto().name, successorName: ME.displayName }] };
}

function mutateAdminUsers(state, method, path, body) {
  if (method === 'POST' && path === '/admin/users/bulk/plan') {
    const a = adminUsersState(state);
    let updated = 0;
    for (const id of body.userIds) {
      const user = a.users.find((u) => u.id === id);
      if (!user) continue;
      const before = { plan: user.plan, expiresAt: user.subscriptionExpiresAt };
      const running = user.plan === body.plan && adminPlanState(user) === body.plan;
      const base = running && user.subscriptionExpiresAt ? Date.parse(user.subscriptionExpiresAt) : Date.now();
      user.plan = body.plan;
      user.subscriptionExpiresAt = body.term.kind === 'unlimited' ? null : body.term.kind === 'until' ? body.term.date
        : running && !user.subscriptionExpiresAt ? null : new Date(base + body.term.days * 86400000).toISOString();
      adminJournal(state, id, 'bulk_plan', before, { plan: user.plan, expiresAt: user.subscriptionExpiresAt, batchSize: body.userIds.length });
      updated++;
    }
    return json({ updated, missing: [] });
  }
  const action = path.match(/^\/admin\/users\/([^/]+)\/(sign-out-all|password-reset)$/);
  if (action && method === 'POST') {
    const user = adminUsersState(state).users.find((u) => u.id === action[1]);
    if (!user) return json({ error: 'user_not_found', message: 'Пользователь не найден' }, 404);
    adminJournal(state, user.id, action[2] === 'sign-out-all' ? 'sign_out_all' : 'password_reset_sent', null, action[2] === 'password-reset' ? { email: user.email } : null);
    return action[2] === 'sign-out-all' ? { status: 204 } : json({ email: user.email });
  }
  const m = path.match(/^\/admin\/users\/([^/]+)(\/plan)?$/);
  if (!m) return undefined;
  const a = adminUsersState(state);
  const user = a.users.find((u) => u.id === m[1]);
  if (!user) return json({ error: 'user_not_found', message: 'Пользователь не найден' }, 404);
  if (method === 'PATCH' && m[2]) {
    Object.assign(user, { plan: body.plan,
      subscriptionExpiresAt: body.plan === 'free' ? null : body.subscriptionExpiresAt === undefined ? inDays(30) : body.subscriptionExpiresAt });
    return { status: 204 };
  }
  if (method === 'PATCH') { Object.assign(user, body); return { status: 204 }; }
  if (method === 'DELETE') {
    const preview = adminDeletionPreview(state, user.id);
    if (preview.blockers.length) return json({ error: 'deletion_blocked', message: 'Удалить нельзя' }, 409);
    a.users = a.users.filter((u) => u.id !== user.id);
    return json(preview);
  }
  return undefined;
}

// --- Admin mailings ----------------------------------------------------------------

const MAILING_STARTERS = [
  { key: 'product_news', name: 'Новость продукта', description: 'Анонс новой возможности с кнопкой «Попробовать»',
    subject: '{{name}}, в ProjectsFlow появилось новое', preheader: 'Коротко о том, что изменилось',
    bodyMarkdown: ['Здравствуйте, {{name}}!', '', '## Что нового', '', 'Мы добавили **новую возможность**.'].join('\n'),
    ctaLabel: 'Попробовать', ctaUrl: 'https://projectsflow.ru/', layout: 'standard', offer: null },
  { key: 'update', name: 'Обновление', description: 'Сводка изменений за период',
    subject: 'Обновления ProjectsFlow', preheader: 'Что изменилось', bodyMarkdown: ['Здравствуйте, {{name}}!', '', '- Пункт'].join('\n'),
    ctaLabel: null, ctaUrl: null, layout: 'standard', offer: null },
  { key: 'come_back', name: 'Приглашение вернуться', description: 'Для тех, кто давно не заходил',
    subject: '{{name}}, мы скучаем', preheader: 'Ваши проекты ждут', bodyMarkdown: 'Здравствуйте, {{name}}!', ctaLabel: null, ctaUrl: null, layout: 'standard', offer: null },
  { key: 'promo_trial', name: 'Прайм на 7 дней', description: 'Промо: пробный Прайм', subject: '{{name}}, Прайм на {{offer}}',
    preheader: 'Воркер сам берёт задачи', bodyMarkdown: ['# Отдайте рутину воркеру', '', 'Прайм на {{offer}}.'].join('\n'),
    ctaLabel: 'Посмотреть Прайм', ctaUrl: 'https://projectsflow.ru/profile', layout: 'trial', offer: { badge: '7 дней', deadline: 'до 30 ноября' } },
];

function mailingState(state) {
  state.mailing ??= { templates: [], campaigns: [], reach: { eligible: PEOPLE.length, unsubscribed: 1, invalid: 0 } };
  return state.mailing;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Stand-in for the server renderer: the same fluid 600px card and phone media query.
function mailingPreviewDto(body) {
  const layout = body.layout && body.layout !== 'standard' ? String(body.layout) : null;
  const offer = layout ? body.offer : null;
  const fill = (s) => String(s ?? '').replace(/\{\{\s*name\s*\}\}/g, ME.displayName).replace(/\{\{\s*workspace\s*\}\}/g, workspaceDto().name)
    .replace(/\{\{\s*offer\s*\}\}/g, offer?.badge || 'подарок').replace(/\{\{\s*deadline\s*\}\}/g, offer?.deadline || 'в ближайшие дни');
  // Promo layouts: hero and offer strip, like the server renderer.
  const promo = layout
    ? `<tr><td data-pf-layout="${escapeHtml(layout)}" style="padding:0;"><img src="/mail/${escapeHtml(layout)}/thumb-2.jpg" alt="" style="display:block;width:100%;"></td></tr>`
      + (offer?.badge ? `<tr><td class="pf-offer" style="padding:20px 32px 0;font-size:56px;">${escapeHtml(offer.badge)}</td></tr>` : '')
    : '';
  const paragraphs = fill(body.bodyMarkdown).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(p)}</p>`).join('');
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>@media (max-width:480px){.pf-shell{padding:0!important}.pf-card{border-radius:0!important}}</style></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;"><table role="presentation" width="100%" class="pf-shell" style="padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" class="pf-card" style="width:100%;max-width:600px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;">
<tr><td style="padding:28px 32px 12px;font-size:13px;font-weight:700;color:#2563eb;">PROJECTSFLOW</td></tr>
${promo}<tr><td style="padding:8px 32px;">${paragraphs}</td></tr>
<tr><td style="padding:16px 32px;background:#f8fafc;font-size:12px;color:#94a3b8;">Отписаться от рассылок</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: fill(body.subject), preheader: fill(body.preheader), html, text: fill(body.bodyMarkdown) };
}

function mutateMailing(state, method, path, body) {
  if (!path.startsWith('/admin/mailings/')) return undefined;
  const m = mailingState(state);
  if (method === 'POST' && path === '/admin/mailings/templates') {
    const now = new Date().toISOString();
    const template = { ...body, id: `tpl-${m.templates.length + 1}`, createdBy: ME.id, createdAt: now, updatedAt: now };
    m.templates.unshift(template);
    return json({ template }, 201);
  }
  const put = method === 'PUT' && path.match(/^\/admin\/mailings\/templates\/([^/]+)$/);
  if (put) {
    const i = m.templates.findIndex((t) => t.id === put[1]);
    if (i < 0) return json({ error: 'template_not_found' }, 404);
    m.templates[i] = { ...m.templates[i], ...body, updatedAt: new Date().toISOString() };
    return json({ template: m.templates[i] });
  }
  if (method === 'POST' && path === '/admin/mailings/preview') return json(mailingPreviewDto(body));
  // Test sends go to the signed-in admin only; nothing leaves the browser in smoke runs.
  if (method === 'POST' && path === '/admin/mailings/test') return json({ to: ME.email });
  if (method === 'POST' && path === '/admin/mailings/reach') return json({ reach: m.reach });
  return undefined;
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
  const mailing = mutateMailing(state, method, path, body);
  if (mailing) return mailing;
  const adminUsers = mutateAdminUsers(state, method, path, body);
  if (adminUsers) return adminUsers;
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
    if (method === 'POST' && rest === '/comments') {
      const now = new Date().toISOString();
      const comment = {
        id: `c-smoke-${Object.values(state.comments ?? {}).flat().length + 1}`,
        taskId, ownerUserId: ME.id, body: body?.body ?? '', actorKind: 'user', agentName: null,
        notifyMode: body?.notify?.mode ?? 'all', replyToCommentId: null, quotedText: null,
        createdAt: now, updatedAt: now, attachments: [], acknowledgements: [],
      };
      state.comments ??= {};
      state.comments[taskId] = [...(state.comments[taskId] ?? []), comment];
      return json({ comment }, 201);
    }
    const commentUpload = rest.match(/^\/comments\/([^/]+)\/attachments$/);
    if (method === 'POST' && commentUpload) {
      const comment = state.comments?.[taskId]?.find((c) => c.id === commentUpload[1]);
      if (!comment) return json({ error: 'not_found' }, 404);
      const attachment = {
        id: `a-smoke-${comment.attachments.length + 1}`, taskId, filename: 'screenshot.png', mimeType: 'image/png',
        sizeBytes: 68, url: SMOKE_PNG_DATA_URL, uploadedAt: new Date().toISOString(),
      };
      comment.attachments.push(attachment);
      return json({ attachment }, 201);
    }
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
  if (method === 'PUT' && path === '/projects/reorder') return noContent();
  const favoriteMatch = method === 'PUT' && path.match(/^\/projects\/([^/]+)\/favorite$/);
  if (favoriteMatch) {
    const project = state.projects.find((p) => p.id === favoriteMatch[1]);
    if (project) project.isFavorite = body?.favorite === true;
    return noContent();
  }
  if (method === 'POST' && /^\/notifications\/[^/]+\/read$/.test(path)) return noContent();
  if (method === 'POST' && path === '/notifications/read-all') return json({ updated: 0 });
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
  function resolveGet(path, workspaceId, query) {
    for (const [pattern, handler] of getRoutes(state, workspaceId)) {
      const match = path.match(pattern);
      if (!match) continue;
      const res = handler(match, query);
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
      const res = resolveGet(path, workspaceId, url.searchParams);
      const delay = state.delays?.[`${workspaceId}:${path}`] ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (res) return fulfill(route, res);
      journal.unknown.push(`GET /api${path}`);
      return fulfill(route, json({}));
    }

    const body = parseBody(request);
    journal.mutations.push({ method, path, body });
    if (path === '/me/telegram/connect/start' && method === 'POST') {
      if (state.telegramStartDelay) await new Promise(resolve => setTimeout(resolve, state.telegramStartDelay));
      if (state.telegramStartError) {
        journal.expectedErrors.push({ url: request.url(), status: 503 });
        return fulfill(route, json({ error: 'telegram_unavailable' }, 503));
      }
      state.telegramLinkSequence = (state.telegramLinkSequence ?? 0) + 1;
      return fulfill(route, json({
        url: `https://t.me/SmokeTest_Bot?start=connect_${String(state.telegramLinkSequence).padStart(43, 'a')}`,
        expiresAt: new Date(Date.now() + (state.telegramLinkTtl ?? 600_000)).toISOString(),
      }));
    }
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
