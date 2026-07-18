export type SitePatchKind = 'text' | 'style' | 'attribute' | 'visibility' | 'command';

export type SiteElementLocator = {
  readonly cssPath: string;
  readonly tagName: string;
  readonly stableAttributes: Readonly<Record<string, string>>;
  readonly textFingerprint?: string;
  readonly ancestorFingerprint?: string;
};

export type SitePatch = {
  readonly id: string;
  readonly projectId: string;
  readonly patchSetId: string;
  readonly locator: SiteElementLocator;
  readonly kind: SitePatchKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly createdRevision: number;
  readonly createdBy: string;
  readonly state: 'draft' | 'queued';
  readonly publishJobId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type SitePatchSnapshot = {
  readonly revision: number;
  readonly patches: readonly SitePatch[];
  readonly draftCount: number;
  readonly redoCount: number;
  readonly queuedCount: number;
  readonly publishJobId: string | null;
};

export type SiteEditorSession = {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly route: string;
  readonly artifactVersion: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
};

export type ProjectEditOperation =
  | 'rewrite_text'
  | 'restyle'
  | 'regenerate_element'
  | 'regenerate_section'
  | 'replace_icon'
  | 'edit_code';

export type ProjectEditJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type ProjectEditJob = {
  readonly id: string;
  readonly projectId: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  readonly dispatcherUserId: string;
  readonly status: ProjectEditJobStatus;
  readonly operation: ProjectEditOperation;
  readonly route: string;
  readonly locator: SiteElementLocator;
  readonly domSnapshot: string;
  readonly computedStyles: Readonly<Record<string, string>>;
  readonly prompt: string;
  readonly artifactVersion: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: string | null;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
