import { createHash, randomBytes } from 'node:crypto';
import { MagicLinkRateLimitedError } from '../../domain/auth/errors.js';
import type { EmailSender } from '../email/EmailSender.js';
import type { MagicTokenRepository } from './MagicTokenRepository.js';

export type RequestMagicLinkInput = {
  readonly email: string;
};

type Deps = {
  readonly tokens: MagicTokenRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly now: () => Date;
  readonly tokenTtlMs: number;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMax: number;
  readonly appUrl: string;
  readonly fromName: string;
};

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function randomToken(): string {
  // 32 bytes = 256-bit entropy. base64url ≈ 43 chars без padding.
  return randomBytes(32).toString('base64url');
}

export class RequestMagicLink {
  constructor(private readonly deps: Deps) {}

  // Возвращает рабочий URL — каждый адаптер сам решает, слать письмом и/или показывать в dev.
  // Кидает MagicLinkRateLimitedError если для этого email перебор за окно.
  async execute(input: RequestMagicLinkInput): Promise<{ url: string }> {
    const email = input.email.trim().toLowerCase();
    const now = this.deps.now();

    const since = new Date(now.getTime() - this.deps.rateLimitWindowMs);
    const recent = await this.deps.tokens.countRecentForEmail(email, since);
    if (recent >= this.deps.rateLimitMax) {
      throw new MagicLinkRateLimitedError(Math.ceil(this.deps.rateLimitWindowMs / 1000));
    }

    const rawToken = randomToken();
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(now.getTime() + this.deps.tokenTtlMs);

    await this.deps.tokens.create({
      id: this.deps.idGen(),
      email,
      tokenHash,
      expiresAt,
    });

    const url = `${this.deps.appUrl.replace(/\/+$/, '')}/auth/magic/consume?token=${encodeURIComponent(rawToken)}`;
    const ttlMin = Math.round(this.deps.tokenTtlMs / 60_000);

    await this.deps.email.send({
      to: email,
      subject: `Вход в ${this.deps.fromName}`,
      text: [
        'Привет!',
        '',
        `Открой ссылку ниже, чтобы войти в ${this.deps.fromName}. Ссылка действует ${ttlMin} минут и работает один раз.`,
        '',
        url,
        '',
        'Если ты не запрашивал эту ссылку — просто проигнорируй письмо.',
      ].join('\n'),
      html: renderMagicLinkHtml({ url, ttlMin, brand: this.deps.fromName }),
    });

    return { url };
  }
}

function renderMagicLinkHtml(args: { url: string; ttlMin: number; brand: string }): string {
  const safeUrl = args.url.replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:32px 16px;background:#0b0d12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e5e7eb;">
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="max-width:480px;width:100%;background:#11141b;border:1px solid #1f2330;border-radius:16px;padding:32px;">
      <tr><td>
        <div style="font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#7c8694;margin-bottom:24px;">${args.brand}</div>
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;color:#f4f6fb;font-weight:600;">Вход по ссылке</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#aab1bf;">Жми кнопку ниже, чтобы войти. Ссылка живёт ${args.ttlMin} минут и работает один раз.</p>
        <a href="${safeUrl}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:600;font-size:15px;">Войти в ${args.brand}</a>
        <p style="font-size:13px;line-height:1.6;margin:32px 0 0;color:#7c8694;">Если кнопка не работает — скопируй ссылку:</p>
        <p style="font-size:12px;line-height:1.5;margin:8px 0 0;color:#7c8694;word-break:break-all;">${safeUrl}</p>
        <hr style="border:none;border-top:1px solid #1f2330;margin:32px 0 16px;" />
        <p style="font-size:12px;line-height:1.6;margin:0;color:#5b6272;">Если ты не запрашивал ссылку — проигнорируй письмо.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}
