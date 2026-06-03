export type MonitoringAnalysisType = 'snapshot' | 'logs' | 'alert' | 'digest';
export type MonitoringAnalysisStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type MonitoringAnalysisResult = {
  readonly jobId: string;
  readonly serverId: string;
  readonly status: MonitoringAnalysisStatus;
  readonly analysisType: MonitoringAnalysisType;
  readonly resultMarkdown: string | null;
  readonly error: string | null;
  readonly costUsd: number | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
};
