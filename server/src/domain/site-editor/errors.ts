export class SiteEditorNotDeployedError extends Error {
  constructor() {
    super('Project site has not been deployed');
    this.name = 'SiteEditorNotDeployedError';
  }
}

export class SiteEditorSessionInvalidError extends Error {
  constructor(message = 'Editor session is invalid or expired') {
    super(message);
    this.name = 'SiteEditorSessionInvalidError';
  }
}

export class SiteEditorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteEditorValidationError';
  }
}

export class SiteEditorRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('Patch set revision conflict');
    this.name = 'SiteEditorRevisionConflictError';
  }
}

export class SiteEditorArtifactConflictError extends Error {
  constructor(readonly currentArtifactVersion: string | null) {
    super('Site artifact version conflict');
    this.name = 'SiteEditorArtifactConflictError';
  }
}

export class SiteEditorPatchNotFoundError extends Error {
  constructor() {
    super('Site patch not found');
    this.name = 'SiteEditorPatchNotFoundError';
  }
}

export class ProjectEditJobNotFoundError extends Error {
  constructor() {
    super('Project edit job not found');
    this.name = 'ProjectEditJobNotFoundError';
  }
}

export class ProjectEditJobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectEditJobStateError';
  }
}

export class ProjectEditDispatcherMissingError extends Error {
  constructor() {
    super('Project dispatcher is not configured');
    this.name = 'ProjectEditDispatcherMissingError';
  }
}
