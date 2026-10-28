export type VoiceTranscriptionInput = {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
  readonly language?: string;
  readonly prompt?: string;
  readonly model?: string;
};

// Speech-to-text port used by Telegram intake and the universal /api/ai/stt endpoint.
// Keeping the provider behind this interface makes routes deterministic in tests and
// prevents Groq details from leaking into the task-composer domain.
export interface VoiceTranscriber {
  readonly enabled: boolean;
  transcribe(input: VoiceTranscriptionInput): Promise<string>;
}
