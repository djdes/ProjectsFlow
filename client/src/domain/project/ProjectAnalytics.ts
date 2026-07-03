import type { ActivityEventItem } from '@/domain/activity/ActivityFeedItem';

// Аналитика просмотров проекта (вкладка «Аналитика» окна активности).
export type ProjectViewsPerDay = {
  readonly date: string; // 'YYYY-MM-DD'
  readonly count: number; // всего просмотров за день
  readonly unique: number; // уникальных зрителей за день
};

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
  readonly perDay: ProjectViewsPerDay[];
  readonly viewers: ProjectViewer[];
};

// Активность проекта (вкладка «Активность» + hover-сводка на кнопке).
export type ProjectActivitySummary = {
  readonly createdAt: Date;
  readonly createdByName: string | null;
  readonly lastEditedAt: Date | null;
  readonly lastEditedByName: string | null;
};

export type ProjectActivity = {
  readonly summary: ProjectActivitySummary;
  readonly items: ActivityEventItem[];
};
