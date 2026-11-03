// Дневные счётчики платформы для вкладки «Статистика» админки. Дни — по Москве (YYYY-MM-DD).
export type DailyCounts = ReadonlyMap<string, number>;

export type PlatformTotals = {
  readonly users: number;
  readonly workspaces: number;
  readonly projects: number;
  readonly tasks: number;
  readonly paidUsers: number;
  readonly activeWeek: number;
  readonly activeMonth: number;
};

export interface PlatformStatsRepository {
  registrationsByDay(fromDay: string): Promise<DailyCounts>;
  // Активный пользователь дня: открывал проекты, входил, создавал задачи или писал комментарии.
  activeUsersByDay(fromDay: string): Promise<DailyCounts>;
  tasksCreatedByDay(fromDay: string): Promise<DailyCounts>;
  commentsByDay(fromDay: string): Promise<DailyCounts>;
  totals(now: Date): Promise<PlatformTotals>;
}
