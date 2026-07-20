// Активная беседа вкладки «ИИ». Живёт в HelpWidget, чтобы переключение вкладок
// («ИИ» ↔ «Поддержка») не теряло разговор, и вынесена отдельно, чтобы виджет и
// панель не зависели друг от друга по кругу.
export type HelpAiSession = {
  readonly conversationId: string;
  // Проект, к которому беседа привязана НАВСЕГДА (null — общий ИИ).
  readonly projectId: string | null;
  readonly projectName: string | null;
};

// Ключ кеша бесед: у каждого проекта своя, плюс одна общая.
export function helpAiContextKey(projectId: string | null): string {
  return projectId ?? '__global__';
}
