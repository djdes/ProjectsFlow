export class KbNotConnectedError extends Error {
  constructor() { super('KB not connected'); this.name = 'KbNotConnectedError'; }
}
export class KbDocumentNotFoundError extends Error {
  constructor() { super('KB document not found'); this.name = 'KbDocumentNotFoundError'; }
}
export class FrontmatterInvalidError extends Error {
  constructor(public readonly errors: readonly { code: string; message: string }[]) {
    super('Frontmatter invalid'); this.name = 'FrontmatterInvalidError';
  }
}
