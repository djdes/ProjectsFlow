import { File } from 'node:buffer';
import {
  fetch as undiciFetch,
  FormData,
  ProxyAgent,
  type Dispatcher,
} from 'undici';
import type {
  VoiceTranscriber,
  VoiceTranscriptionInput,
} from '../../application/telegram/VoiceTranscriber.js';

const DEFAULT_API_BASE_URL = 'https://api.groq.com';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_LANGUAGE = 'ru';
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const GROQ_AUDIO_EXTENSIONS = new Set([
  'flac',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'm4a',
  'ogg',
  'opus',
  'wav',
  'webm',
]);

export type GroqVoiceTranscriberOptions = {
  readonly apiKey: string;
  readonly apiBaseUrl?: string;
  readonly model?: string;
  readonly language?: string;
  readonly maxBytes?: number;
  readonly proxyUrl?: string;
};

type GroqTranscriptionResponse = {
  readonly text?: unknown;
  readonly error?: { readonly message?: unknown };
};

// Telegram getFile names voice notes `*.oga`. Groq accepts the same Ogg/Opus bytes but validates
// the multipart filename against its documented `*.ogg`/`*.opus` extensions and returns HTTP 400
// for `*.oga`. Normalize only unsupported extensions; known uploaded audio names stay untouched.
export function normalizeGroqAudioFilename(filename: string, mimeType: string): string {
  const clean = filename.trim() || 'telegram-voice';
  const currentExtension = clean.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
  if (GROQ_AUDIO_EXTENSIONS.has(currentExtension)) return clean;

  const normalizedMime = mimeType.split(';', 1)[0]?.trim().toLowerCase();
  const extension =
    currentExtension === 'oga' || normalizedMime === 'audio/ogg'
      ? 'ogg'
      : normalizedMime === 'audio/webm'
        ? 'webm'
        : normalizedMime === 'audio/wav' || normalizedMime === 'audio/x-wav'
          ? 'wav'
          : normalizedMime === 'audio/mp4'
            ? 'm4a'
            : normalizedMime === 'audio/mpeg'
              ? 'mp3'
              : 'ogg';
  const basename = clean.replace(/\.[^./\\]+$/, '').trim() || 'telegram-voice';
  return `${basename}.${extension}`;
}

export class GroqVoiceTranscriber implements VoiceTranscriber {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly model: string;
  private readonly language: string;
  private readonly maxBytes: number;
  private readonly dispatcher: Dispatcher | undefined;

  constructor(options: GroqVoiceTranscriberOptions) {
    this.apiKey = options.apiKey.trim();
    this.apiBaseUrl = (options.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.language = options.language?.trim() || DEFAULT_LANGUAGE;
    this.maxBytes =
      Number.isFinite(options.maxBytes) && (options.maxBytes ?? 0) > 0
        ? Math.floor(options.maxBytes!)
        : DEFAULT_MAX_BYTES;
    this.dispatcher = options.proxyUrl?.trim()
      ? new ProxyAgent(options.proxyUrl.trim())
      : undefined;
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  async transcribe(input: VoiceTranscriptionInput): Promise<string> {
    if (!this.enabled) throw new Error('Groq voice transcription is not configured');
    if (input.data.length === 0) throw new Error('Voice file is empty');
    if (input.data.length > this.maxBytes) {
      throw new Error(`Voice file exceeds transcription limit (${this.maxBytes} bytes)`);
    }

    const form = new FormData();
    const uploadFilename = normalizeGroqAudioFilename(
      input.filename || 'telegram-voice.ogg',
      input.mimeType,
    );
    form.set(
      'file',
      new File([new Uint8Array(input.data)], uploadFilename, {
        type: input.mimeType || 'audio/ogg',
      }),
    );
    form.set('model', this.model);
    form.set('language', this.language);
    form.set('response_format', 'json');
    form.set('temperature', '0');

    const response = await undiciFetch(`${this.apiBaseUrl}/openai/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as
        | GroqTranscriptionResponse
        | null;
      const providerMessage =
        typeof errorPayload?.error?.message === 'string'
          ? errorPayload.error.message.replace(/\s+/g, ' ').trim().slice(0, 240)
          : '';
      throw new Error(
        `Groq voice transcription failed with HTTP ${response.status}` +
          (providerMessage ? `: ${providerMessage}` : ''),
      );
    }

    const payload = (await response.json().catch(() => null)) as GroqTranscriptionResponse | null;
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new Error('Groq returned an empty voice transcription');
    return text;
  }
}
