export type ProjectStatus = 'active' | 'paused' | 'archived';

export type FinanceVisibility = 'owner' | 'members';

// Где живёт База знаний проекта: нет / GitHub-репо / локально (в БД, без git).
export type KbKind = 'none' | 'github' | 'local';

export type Project = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;
  // Тип Базы знаний: none / github / local. Заменяет «kbRepoFullName !== null» как индикатор.
  readonly kbKind: KbKind;
  // Кто видит финансы проекта: 'owner' (по умолчанию) или 'members' (все участники).
  readonly financeVisibility: FinanceVisibility;
  // Ralph-диспетчер: какой member отвечает за автономное выполнение задач этого
  // проекта (через MCP /loop). NULL = ручной режим. Auto-NULL при revoke последнего
  // активного agent-токена этого юзера.
  readonly dispatcherUserId: string | null;
  // Мультизадачный воркер: true ⇒ диспетчер может выполнять до N задач этого проекта
  // параллельно (а не строго одну за раз). false (по умолчанию) = старое поведение.
  // Менять может любой участник проекта (viewer+). См. db/070.
  readonly multiTaskWorker: boolean;
  // True для phantom-проекта «Входящие». На юзера ровно один такой; создаётся лениво
  // через GetOrCreateInbox. Из обычных списков (sidebar, HomePage) клиент должен
  // отфильтровать inbox-проекты — у них отдельная вкладка.
  readonly isInbox: boolean;
  readonly createdAt: Date;
};
