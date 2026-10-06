import type { LlmJsonSchema } from '../../llm/LlmTransport.js';

// JSON-схемы ответов compose (строгий режим Responses API): все поля обязательны, лишних нет,
// «нет значения» — null. Структура совпадает с «Структура ответа» в промптах прохода 1 и 2.

const nullableString = { type: ['string', 'null'] } as const;

export const COMPOSE_PASS1_SCHEMA: LlmJsonSchema = {
  name: 'compose_segments',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'segments'],
    properties: {
      version: { type: 'integer' },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'title',
            'simpleBody',
            'projectId',
            'projectName',
            'confidence',
            'assigneeUserId',
            'assigneeName',
            'deadline',
            'taskType',
            'existingTaskId',
            'sourceExcerpt',
          ],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            simpleBody: { type: 'string' },
            projectId: nullableString,
            projectName: nullableString,
            confidence: { type: 'number' },
            assigneeUserId: nullableString,
            assigneeName: nullableString,
            deadline: nullableString,
            taskType: { type: 'string', enum: ['feature', 'bug'] },
            existingTaskId: nullableString,
            sourceExcerpt: { type: 'string' },
          },
        },
      },
    },
  },
};

export const COMPOSE_PASS2_SCHEMA: LlmJsonSchema = {
  name: 'compose_advanced',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'segments'],
    properties: {
      version: { type: 'integer' },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'advancedBody'],
          properties: {
            id: { type: 'string' },
            advancedBody: { type: 'string' },
          },
        },
      },
    },
  },
};
