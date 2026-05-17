// Порт для хеширования agent-токенов. Реализация в infrastructure/ (Argon2 как и пароли).
// Plaintext-токен — крипто-случайная строка, генерируется в use-case'е.
export interface AgentTokenHasher {
  hash(plaintext: string): Promise<string>;
  // Сравнение plaintext'а с хешем (для аутентификации входящих запросов).
  verify(plaintext: string, hash: string): Promise<boolean>;
}
