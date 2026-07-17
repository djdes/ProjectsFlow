export type VoiceTranscriptionInput = {
  readonly data: Buffer;
  readonly filename: string;
  readonly mimeType: string;
};

// Speech-to-text port used by Telegram intake. Keeping the provider behind this
// interface makes the webhook deterministic in tests and prevents Groq details
// from leaking into the task-composer domain.
export interface VoiceTranscriber {
  readonly enabled: boolean;
  transcribe(input: VoiceTranscriptionInput): Promise<string>;
}
