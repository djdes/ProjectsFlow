import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGroqAudioFilename } from './GroqVoiceTranscriber.js';

test('Telegram .oga voice filename is normalized to Groq-supported .ogg', () => {
  assert.equal(normalizeGroqAudioFilename('voice/file_123.oga', 'audio/ogg'), 'voice/file_123.ogg');
});

test('already supported audio filenames stay unchanged', () => {
  assert.equal(normalizeGroqAudioFilename('voice-note.opus', 'audio/ogg'), 'voice-note.opus');
  assert.equal(normalizeGroqAudioFilename('recording.webm', 'audio/webm'), 'recording.webm');
});

test('generic Telegram filename gets an extension based on MIME type', () => {
  assert.equal(normalizeGroqAudioFilename('telegram-file', 'audio/ogg'), 'telegram-file.ogg');
  assert.equal(normalizeGroqAudioFilename('telegram-file.bin', 'audio/mpeg'), 'telegram-file.mp3');
});
