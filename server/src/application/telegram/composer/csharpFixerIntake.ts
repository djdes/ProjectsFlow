import { createHash, createHmac } from 'node:crypto';

export type IntakeConfig = { chatId: number; projectId: string; signingKey: string };
export type IntakeSource = {
  chatId: number; userId: number; messageId: number; messageThreadId: number | null; senderName: string;
};

export function csharpFixerConfig(env: NodeJS.ProcessEnv = process.env): IntakeConfig | null {
  if (!env.CSHARP_FIXER_CHAT_ID && !env.CSHARP_FIXER_PROJECT_ID && !env.CSHARP_FIXER_SIGNING_KEY) return null;
  const chatId = Number(env.CSHARP_FIXER_CHAT_ID);
  const projectId = env.CSHARP_FIXER_PROJECT_ID?.trim();
  const signingKey = env.CSHARP_FIXER_SIGNING_KEY;
  if (!Number.isSafeInteger(chatId) || chatId >= 0 || !projectId || !signingKey || signingKey.length < 32)
    throw new Error('CSharpFixer: configure negative chat ID, project ID and 32+ character signing key');
  return { chatId, projectId, signingKey };
}

export function stripCsharpFixerOrigin(text: string): string {
  return text.replace(/\s*<!-- csharp-fixer-origin:[\s\S]*? -->/g, '').trim();
}

export function signCsharpFixerRequest(rawText: string, source: IntakeSource, config: IntakeConfig): string {
  if (source.chatId !== config.chatId || !Number.isSafeInteger(source.userId) || source.userId <= 0 ||
      !Number.isSafeInteger(source.messageId) || source.messageId <= 0 ||
      (source.messageThreadId !== null && (!Number.isSafeInteger(source.messageThreadId) || source.messageThreadId <= 0)))
    throw new Error('CSharpFixer: invalid Telegram source');
  const text = stripCsharpFixerOrigin(rawText);
  if (!text) throw new Error('CSharpFixer: empty incident');
  const payload = Buffer.from(JSON.stringify({
    ...source,
    senderName: source.senderName.slice(0, 200),
    projectId: config.projectId,
    textSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  }), 'utf8').toString('base64');
  const signature = createHmac('sha256', config.signingKey).update(payload, 'utf8').digest('hex');
  return `${text}\n\n<!-- csharp-fixer-origin:${payload}:${signature} -->`;
}
