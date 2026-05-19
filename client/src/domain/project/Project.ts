export type ProjectStatus = 'active' | 'paused' | 'archived';

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly gitRepoUrl: string | null;
  readonly kbRepoFullName: string | null;
  // True для phantom-проекта «Входящие». Из обычных списков (sidebar, HomePage) такие
  // проекты надо фильтровать — у них отдельная вкладка /inbox.
  readonly isInbox: boolean;
  readonly createdAt: Date;
};
