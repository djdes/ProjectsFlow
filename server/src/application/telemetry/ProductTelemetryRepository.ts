export const PRODUCT_ACTIONS = [
  'create_task',
  'share_project',
  'filter_tasks',
  'publish_project',
  'archive_project',
  'delete_project',
] as const;

export type ProductAction = (typeof PRODUCT_ACTIONS)[number];
export type ProductActionResult = 'started' | 'success' | 'failure';

export interface ProductTelemetryRepository {
  record(input: {
    readonly id: string;
    readonly userId: string;
    readonly projectId: string | null;
    readonly action: ProductAction;
    readonly result: ProductActionResult;
    readonly durationMs: number | null;
  }): Promise<void>;
}
