// Задеплоенный статический результат проекта (self-serve воркер-раннер, db/098).
// Одна запись на проект (последний деплой). slug — отдельный поддомен, независимый от
// public_slug доски: результат живёт, даже если публичный канбан выключен. См. spec 2026-07-06.
export type SiteArtifact = {
  readonly projectId: string;
  readonly slug: string;
  readonly fileCount: number;
  readonly bytes: number;
  readonly publishedAt: Date;
};

// Единая сборка URL результата: <slug>.<baseDomain>. Меняешь схему поддомена — только здесь.
export function siteUrl(baseDomain: string, slug: string): string {
  return `https://${slug}.${baseDomain}`;
}
