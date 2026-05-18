export type DeviceCodeStatus = 'pending' | 'approved' | 'consumed' | 'denied' | 'expired';

export type DeviceCodeInfo = {
  readonly userCode: string;
  readonly status: DeviceCodeStatus;
  readonly expiresAt: Date;
  readonly tokenName: string | null;
};

export interface AgentDeviceRepository {
  // Возвращает meta по user_code (status, expires, etc.). Если код не найден или истёк — throw'ит.
  // Используется на странице /device, чтобы показать "Подключить Claude Code?" с правильными данными.
  getInfo(userCode: string): Promise<DeviceCodeInfo>;

  // Создаёт agent-token и линкует его к device_code. После этого MCP-клиент при следующем poll'е
  // получит plaintext. Throw'ит если код не найден / уже approved / истёк.
  approve(userCode: string, tokenName: string): Promise<void>;
}
