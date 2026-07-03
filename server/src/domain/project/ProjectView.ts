// Аналитика просмотров проекта (вкладка «Аналитика» в окне активности проекта).

// Число просмотров за конкретную дату (МSK-независимо, по UTC-дате БД — для v1 достаточно).
export type ProjectViewsPerDay = {
  readonly date: string; // 'YYYY-MM-DD'
  readonly count: number; // всего просмотров за день
  readonly unique: number; // уникальных зрителей за день (COUNT DISTINCT user)
};

// Зритель проекта: кто заходил, сколько раз и когда в последний раз.
export type ProjectViewer = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly lastViewedAt: Date;
  readonly viewCount: number;
};

export type ProjectAnalytics = {
  readonly totalViews: number;
  readonly windowDays: number;
  readonly perDay: ProjectViewsPerDay[]; // только дни с ненулевым count; клиент дозаполнит нули
  readonly viewers: ProjectViewer[]; // по убыванию lastViewedAt
};
