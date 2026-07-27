// Состояние ежедневной сводки руководителям: за какую дату она уже ушла (db/147).
// Планировщик тикает раз в минуту, поэтому «уже отправлено сегодня» должно переживать
// и повторный тик, и рестарт процесса.
export interface LeadDigestStateRepository {
  // Пространства, где есть хотя бы один руководитель, вместе с датой последней отправки.
  listWorkspacesWithLeads(): Promise<ReadonlyArray<{ workspaceId: string; lastSentOn: string | null }>>;
  markSent(workspaceId: string, dateMsk: string): Promise<void>;
}
