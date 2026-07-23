import type {
  AutomationConfig,
  AutomationLimitKind,
  DeployMethod,
  GitAuthorMode,
} from '@/domain/automation/AutomationConfig';

export type SaveAutomationInput = {
  readonly enabled: boolean;
  readonly limitKind: AutomationLimitKind;
  readonly limitCount: number | null;
  readonly limitMinutes: number | null;
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly ralphMode: string;
  readonly gitAuthorMode: GitAuthorMode;
  readonly gitAuthorName: string | null;
  readonly gitAuthorEmail: string | null;
  readonly ignoreClaudeMd: boolean;
  readonly ultracodeReviewEnabled: boolean;
  readonly deployMethod: DeployMethod;
  readonly deployCommand: string | null;
  readonly commitSyncEnabled: boolean;
  readonly commitSyncHour: number;
  readonly commitSyncMinute: number;
  readonly commitSyncThresholdHours: number;
  readonly commitSyncAction: 'propose' | 'auto';
  readonly assigneeDigestEnabled: boolean;
  readonly criteria: ReadonlyArray<{
    readonly key: string;
    readonly enabled: boolean;
    readonly systemPrompt: string;
    readonly userHint: string | null;
  }>;
};

// Результат ручного запуска сверки коммитов «Сверить сейчас».
export type RunCommitSyncResult =
  | { readonly status: 'queued'; readonly jobId: string }
  | { readonly status: 'already_running' }
  | { readonly status: 'unavailable' };

export interface AutomationRepository {
  get(projectId: string): Promise<AutomationConfig>;
  save(projectId: string, input: SaveAutomationInput): Promise<AutomationConfig>;
  // Поставить сверку коммитов немедленно (мимо расписания). Раннер подхватит job.
  runCommitSyncNow(projectId: string): Promise<RunCommitSyncResult>;
}
