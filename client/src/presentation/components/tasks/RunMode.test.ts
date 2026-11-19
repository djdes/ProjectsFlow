import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunModeSelect } from './RunMode';
import { RUN_MODE_META, RUN_MODES } from '@/domain/task/Task';
import { VERSION_FIELD_OPTIONS } from './taskVersionLabels';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const render = (props: Parameters<typeof RunModeSelect>[0]): string =>
  renderToStaticMarkup(React.createElement(RunModeSelect, props));

test('run mode: два режима с подписями из спеки, по умолчанию quick', () => {
  assert.deepEqual(RUN_MODES, ['quick', 'full']);
  assert.equal(RUN_MODE_META.quick.label, 'Обычное изменение');
  assert.equal(RUN_MODE_META.full.label, 'Полный прогон');
  assert.match(RUN_MODE_META.full.description, /2–3 раза/);
});

test('run mode: селектор показывает выбранный режим', () => {
  const quick = render({ value: 'quick', onChange: () => {} });
  assert.match(quick, /Обычное изменение/);
  assert.match(quick, /aria-label="Режим запуска: Обычное изменение"/);
  const full = render({ value: 'full', onChange: () => {}, iconOnly: true });
  assert.match(full, /aria-label="Режим запуска: Полный прогон"/);
  assert.doesNotMatch(full, />Полный прогон</);
});

test('run mode: подпись поля в истории версий', () => {
  assert.equal(VERSION_FIELD_OPTIONS.find((o) => o.field === 'runMode')?.label, 'Режим запуска');
});
