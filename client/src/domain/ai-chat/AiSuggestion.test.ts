import assert from 'node:assert/strict';
import test from 'node:test';
import { readAiSuggestions } from './AiSuggestion';

test('reads title/prompt pairs from assistant message metadata', () => {
  assert.deepEqual(
    readAiSuggestions({
      suggestions: [
        { title: 'Добавить галерею', prompt: 'Добавь на главную галерею с фотографиями готовых блюд.' },
        { title: 'Собрать отзывы', prompt: 'Сделай блок отзывов покупателей под каталогом.' },
      ],
    }),
    [
      { id: 'suggestion-1', title: 'Добавить галерею', prompt: 'Добавь на главную галерею с фотографиями готовых блюд.' },
      { id: 'suggestion-2', title: 'Собрать отзывы', prompt: 'Сделай блок отзывов покупателей под каталогом.' },
    ],
  );
});

test('accepts a bare string — the label then repeats the prompt', () => {
  assert.deepEqual(readAiSuggestions({ suggestions: ['Показать статистику'] }), [
    { id: 'suggestion-1', title: 'Показать статистику', prompt: 'Показать статистику' },
  ]);
});

test('degrades silently when the server sent nothing usable', () => {
  assert.deepEqual(readAiSuggestions(null), []);
  assert.deepEqual(readAiSuggestions('nope'), []);
  assert.deepEqual(readAiSuggestions({}), []);
  assert.deepEqual(readAiSuggestions({ suggestions: 'одна строка' }), []);
  assert.deepEqual(readAiSuggestions({ suggestions: [null, 42, [], { title: '   ' }] }), []);
});

test('falls back to the prompt when only one of the two fields is present', () => {
  assert.deepEqual(readAiSuggestions({ suggestions: [{ prompt: 'Только промпт' }] }), [
    { id: 'suggestion-1', title: 'Только промпт', prompt: 'Только промпт' },
  ]);
  assert.deepEqual(readAiSuggestions({ suggestions: [{ title: 'Только подпись' }] }), [
    { id: 'suggestion-1', title: 'Только подпись', prompt: 'Только подпись' },
  ]);
});

test('collapses control characters, clamps values and caps the list', () => {
  const parsed = readAiSuggestions({
    suggestions: [
      { title: 'Первая строка\nвторая', prompt: 'x'.repeat(2_500) },
      ...Array.from({ length: 20 }, (_, index) => ({ title: `подсказка ${index}`, prompt: `промпт ${index}` })),
    ],
  });
  assert.equal(parsed[0]?.title, 'Первая строка вторая');
  assert.equal(parsed[0]?.prompt.length, 2_000);
  assert.equal(parsed.length, 12);
});
