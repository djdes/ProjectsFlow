// Лёгкий мост «состояние публикации изменилось» между окном Share/Publish и плашкой
// «проект опубликован» — чтобы после Publish/Unpublish плашка обновилась без полного
// рефетча проекта. Живёт в памяти вкладки (как dismiss-событие плашки).
export const PUBLISH_CHANGED_EVENT = 'pf:project-publish-changed';

export type PublishChangedDetail = {
  readonly projectId: string;
  readonly isPublic: boolean;
  readonly publicSlug: string | null;
  readonly publicIndexing: boolean;
};

export function emitPublishChanged(detail: PublishChangedDetail): void {
  window.dispatchEvent(new CustomEvent<PublishChangedDetail>(PUBLISH_CHANGED_EVENT, { detail }));
}

export function onPublishChanged(cb: (d: PublishChangedDetail) => void): () => void {
  const handler = (e: Event): void => cb((e as CustomEvent<PublishChangedDetail>).detail);
  window.addEventListener(PUBLISH_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PUBLISH_CHANGED_EVENT, handler);
}
