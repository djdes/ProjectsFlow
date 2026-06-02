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
  readonly criteria: ReadonlyArray<{
    readonly key: string;
    readonly enabled: boolean;
    readonly systemPrompt: string;
    readonly userHint: string | null;
  }>;
};

export interface AutomationRepository {
  get(projectId: string): Promise<AutomationConfig>;
  save(projectId: string, input: SaveAutomationInput): Promise<AutomationConfig>;
}
