import type {
  EmailActionTokenRepository,
  EmailActionType,
} from './EmailActionTokenRepository.js';

type Deps = {
  readonly tokens: EmailActionTokenRepository;
  readonly idGen: () => string;
  readonly now: () => Date;
  // Срок жизни токена (мс). Дайджест ежедневный — даём несколько дней на клик.
  readonly ttlMs: number;
};

// Создаёт одноразовую/срочную токен-ссылку для действия из письма. Возвращает сам token
// (его подставляем в URL письма: {appUrl}/api/email-actions/{token}).
export class CreateEmailActionToken {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    action: EmailActionType;
    taskId: string;
    projectId: string;
    userId: string;
  }): Promise<string> {
    // 2 uuid без дефисов = 64 hex-символа: достаточно энтропии, влезает в VARCHAR(64).
    const token = `${this.deps.idGen()}${this.deps.idGen()}`.replace(/-/g, '');
    const expiresAt = new Date(this.deps.now().getTime() + this.deps.ttlMs);
    await this.deps.tokens.create({
      id: this.deps.idGen(),
      token,
      action: input.action,
      taskId: input.taskId,
      projectId: input.projectId,
      userId: input.userId,
      expiresAt,
    });
    return token;
  }
}
