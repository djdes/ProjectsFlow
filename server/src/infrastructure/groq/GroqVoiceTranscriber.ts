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
};

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
    form.set(
      'file',
      new File([new Uint8Array(input.data)], input.filename || 'telegram-voice.ogg', {
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
      // Do not include the provider body in logs/errors: it can contain account or request data.
      throw new Error(`Groq voice transcription failed with HTTP ${response.status}`);
    }

    const payload = (await response.json().catch(() => null)) as GroqTranscriptionResponse | null;
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new Error('Groq returned an empty voice transcription');
    return text;
  }
}
