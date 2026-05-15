export class KbNotConnectedError extends Error {
  constructor() {
    super('Project does not have a KB repo connected');
    this.name = 'KbNotConnectedError';
  }
}

export class KbRepoAlreadyConnectedError extends Error {
  constructor() {
    super('Project already has a KB repo');
    this.name = 'KbRepoAlreadyConnectedError';
  }
}

export class KbDocumentNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`KB document not found: ${path}`);
    this.name = 'KbDocumentNotFoundError';
  }
}

export class FrontmatterInvalidError extends Error {
  constructor(public readonly errors: readonly { code: string; message: string }[]) {
    super(`Frontmatter validation failed: ${errors.map((e) => e.message).join('; ')}`);
    this.name = 'FrontmatterInvalidError';
  }
}

export class KbRepoConflictError extends Error {
  constructor() {
    super('KB document was modified concurrently (SHA mismatch)');
    this.name = 'KbRepoConflictError';
  }
}
