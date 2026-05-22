export type ProjectStatus = 'active' | 'paused' | 'archived';

export type FinanceVisibility = 'owner' | 'members';

export type Project = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;
  // Кто видит финансы проекта: 'owner' (по умолчанию) или 'members' (все участники).
  readonly financeVisibility: FinanceVisibility;
  // True для phantom-проекта «Входящие». На юзера ровно один такой; создаётся лениво
  // через GetOrCreateInbox. Из обычных списков (sidebar, HomePage) клиент должен
  // отфильтровать inbox-проекты — у них отдельная вкладка.
  readonly isInbox: boolean;
  readonly createdAt: Date;
};
