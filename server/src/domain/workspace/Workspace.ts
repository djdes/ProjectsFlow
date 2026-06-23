// Пространство (workspace): верхнеуровневый изолированный контейнер над проектами.
// Проект принадлежит ровно одному пространству; у пространства свои участники.
export type Workspace = {
  readonly id: string;
  readonly name: string;
  // Эмодзи-иконка; null = дефолт (первая буква названия в UI).
  readonly icon: string | null;
  readonly ownerUserId: string;
  readonly createdAt: Date;
};
