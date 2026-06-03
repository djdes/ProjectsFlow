export type MonitoringAnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const MONITORING_ANALYSIS_STATUSES: readonly MonitoringAnalysisStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

// Тип анализа — диспетчер по нему выбирает фокус промпта.
// snapshot — общая диагностика метрик; logs — разбор хвостов логов; alert — причина алерта;
// digest — периодический дайджест здоровья (закладка под будущие сценарии).
export type MonitoringAnalysisType = 'snapshot' | 'logs' | 'alert' | 'digest';

export const MONITORING_ANALYSIS_TYPES: readonly MonitoringAnalysisType[] = [
  'snapshot',
  'logs',
  'alert',
  'digest',
];

export type MonitoringAnalysisJob = {
  readonly id: string;
  readonly createdBy: string;
  readonly projectId: string;
  readonly serverId: string;
  readonly dispatcherUserId: string;
  readonly status: MonitoringAnalysisStatus;
  readonly analysisType: MonitoringAnalysisType;
  readonly alertId: string | null;
  readonly context: string | null;
  readonly note: string | null;
  readonly resultMarkdown: string | null;
  readonly error: string | null;
  readonly costUsd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
