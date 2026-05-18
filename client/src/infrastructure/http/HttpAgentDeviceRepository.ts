import type {
  AgentDeviceRepository,
  DeviceCodeInfo,
} from '@/application/agent/AgentDeviceRepository';
import { httpClient } from './httpClient';

type InfoDto = {
  userCode: string;
  status: 'pending' | 'approved' | 'consumed' | 'denied' | 'expired';
  expiresAt: string;
  tokenName: string | null;
};

export class HttpAgentDeviceRepository implements AgentDeviceRepository {
  async getInfo(userCode: string): Promise<DeviceCodeInfo> {
    const dto = await httpClient.get<InfoDto>(
      `/agent/device/info?userCode=${encodeURIComponent(userCode)}`,
    );
    return {
      userCode: dto.userCode,
      status: dto.status,
      expiresAt: new Date(dto.expiresAt),
      tokenName: dto.tokenName,
    };
  }

  async approve(userCode: string, tokenName: string): Promise<void> {
    await httpClient.post<void>('/agent/device/approve', { userCode, tokenName });
  }
}
