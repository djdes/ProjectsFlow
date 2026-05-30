import type { AutomationConfig, AutomationLimitKind } from '@/domain/automation/AutomationConfig';

export type SaveAutomationInput = {
  readonly enabled: boolean;
  readonly limitKind: AutomationLimitKind;
  readonly limitCount: number | null;
  readonly limitMinutes: number | null;
  readonly pauseMinSeconds: number;
  readonly pauseMaxSeconds: number;
  readonly ralphMode: string;
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
