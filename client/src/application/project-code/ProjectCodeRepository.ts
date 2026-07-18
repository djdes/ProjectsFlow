export type ProjectCodeRestriction = 'sensitive' | 'binary' | 'too_large';

export type ProjectCodeTreeEntry = {
  readonly path: string;
  readonly sha: string;
  readonly type: 'file' | 'dir';
  readonly size: number;
  readonly restricted: boolean;
  readonly restrictedReason?: ProjectCodeRestriction;
};

export type ProjectCodeTree = {
  readonly fullName: string;
  readonly entries: readonly ProjectCodeTreeEntry[];
  readonly truncated: boolean;
};

export type ProjectCodeFile = {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
  readonly size: number;
};

export type SaveProjectCodeFileInput = {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
  readonly message?: string;
};

export type SaveProjectCodeFileResult = {
  readonly path: string;
  readonly sha: string;
  readonly commitMessage: string;
};

export interface ProjectCodeRepository {
  getTree(projectId: string): Promise<ProjectCodeTree>;
  getFile(projectId: string, path: string): Promise<ProjectCodeFile>;
  saveFile(projectId: string, input: SaveProjectCodeFileInput): Promise<SaveProjectCodeFileResult>;
}
