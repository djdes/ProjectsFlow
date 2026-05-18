// Pairing-flow для подключения MCP-агентов без копипасты токена.
// Аналог OAuth 2.0 device authorization grant (RFC 8628), но упрощённый:
// клиент создаёт device_code, юзер вводит короткий user_code в браузере,
// клиент поллит /token до approve и забирает agent_token.

export type AgentDeviceCodeStatus =
  | 'pending' // только что создан клиентом, ждём apporve в браузере
  | 'approved' // юзер approved, plaintext-токен готов к poll'у
  | 'consumed' // клиент забрал токен, всё, дальнейшие poll вернут 410
  | 'denied' // юзер отклонил
  | 'expired'; // TTL истёк

export type AgentDeviceCode = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly status: AgentDeviceCodeStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly userId: string | null;
  readonly agentTokenId: string | null;
  readonly agentTokenName: string | null;
};
