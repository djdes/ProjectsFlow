export class GithubIntegrationDisabledError extends Error {
  constructor() {
    super('GitHub integration is not configured (set GITHUB_CLIENT_ID in .env)');
    this.name = 'GithubIntegrationDisabledError';
  }
}

export class GithubDeviceFlowPendingError extends Error {
  constructor() {
    super('User has not yet entered the code on github.com/login/device');
    this.name = 'GithubDeviceFlowPendingError';
  }
}

export class GithubDeviceFlowExpiredError extends Error {
  constructor() {
    super('Device code expired — start over');
    this.name = 'GithubDeviceFlowExpiredError';
  }
}

export class GithubDeviceFlowSlowDownError extends Error {
  constructor(public readonly newInterval: number) {
    super(`Slow down polling — new interval ${newInterval}s`);
    this.name = 'GithubDeviceFlowSlowDownError';
  }
}

export class GithubNotConnectedError extends Error {
  constructor() {
    super('User has not connected GitHub');
    this.name = 'GithubNotConnectedError';
  }
}

export class GithubRepoUrlInvalidError extends Error {
  constructor(public readonly url: string) {
    super(`Cannot parse owner/repo from URL: ${url}`);
    this.name = 'GithubRepoUrlInvalidError';
  }
}

export class GithubApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export class GithubRepoNameTakenError extends Error {
  constructor(public readonly repoName: string) {
    super(`Repository name already taken: ${repoName}`);
    this.name = 'GithubRepoNameTakenError';
  }
}
