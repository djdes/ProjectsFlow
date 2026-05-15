import type { DeviceCodeResponse, GithubApiClient } from './GithubApiClient.js';

type Deps = {
  readonly api: GithubApiClient;
  readonly storeDeviceCode: (userId: string, deviceCode: string, interval: number, expiresAt: Date) => void;
  readonly now: () => Date;
};

export type DeviceFlowInitiation = {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: Date;
  readonly intervalSec: number;
};

export class StartDeviceFlow {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<DeviceFlowInitiation> {
    const res: DeviceCodeResponse = await this.deps.api.requestDeviceCode();
    const expiresAt = new Date(this.deps.now().getTime() + res.expiresIn * 1000);
    this.deps.storeDeviceCode(userId, res.deviceCode, res.interval, expiresAt);
    return {
      userCode: res.userCode,
      verificationUri: res.verificationUri,
      expiresAt,
      intervalSec: res.interval,
    };
  }
}
