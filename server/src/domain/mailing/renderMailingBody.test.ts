import assert from 'node:assert/strict';
import test from 'node:test';
import { fillMailingVariables, findUnknownMailingVariables, renderMailingBody } from './renderMailingBody.js';

const vars = { name: 'Анна', workspace: 'Ромашка' };

test('variables: substitution, inline fallback, default fallback, unknown left as typed', () => {
  assert.equal(fillMailingVariables('Привет, {{name}} из {{ workspace }}!', vars), 'Привет, Анна из Ромашка!');
  assert.equal(fillMailingVariables('Привет, {{name|друзья}}', { name: '  ', workspace: '' }), 'Привет, друзья');
  assert.equal(fillMailingVariables('{{name}} / {{workspace}}', { name: '', workspace: '' }), 'коллега / ProjectsFlow');
  assert.equal(fillMailingVariables('{{NAME}} {{promo}}', vars), 'Анна {{promo}}');
  assert.deepEqual(findUnknownMailingVariables('{{name}} {{promo}} {{promo}} {{city|x}}'), ['promo', 'city']);
});

test('variables cannot inject markup, links or bold: values are escaped after parsing', () => {
  const evil = { name: '**жир** [клик](https://evil.example) <script>x</script>', workspace: '' };
  const { html, text } = renderMailingBody('Привет, {{name}}!', evil);
  assert.ok(!html.includes('<strong>'));
  assert.ok(!html.includes('<a '));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(text.includes('**жир** [клик](https://evil.example)'));
});

test('a link whose URL is built from a variable renders as plain text', () => {
  const { html } = renderMailingBody('[профиль](https://x.example/{{name}})', vars);
  assert.ok(!html.includes('<a '));
  assert.ok(html.includes('профиль'));
});

test('markdown subset: headings, lists, emphasis, links, quote, rule, code, task items', () => {
  const md = [
    '## Что нового',
    '',
    'Текст **жирный**, *курсив*, ~~зачёркнут~~ и `код`.',
    'Вторая строка с [ссылкой](https://projectsflow.ru/a?b=1&c=2).',
    '',
    '- один',
    '- [x] сделано',
    '',
    '1. первый',
    '2. второй',
    '',
    '> цитата',
    '',
    '---',
    '',
    'Голая ссылка https://projectsflow.ru/x.',
    '',
    '[опасно](javascript:alert(1))',
  ].join('\n');
  const { html, text } = renderMailingBody(md, vars);
  assert.match(html, /<h2 [^>]*>Что нового<\/h2>/);
  assert.match(html, /<strong>жирный<\/strong>/);
  assert.match(html, /<em>курсив<\/em>/);
  assert.match(html, /<s>зачёркнут<\/s>/);
  assert.match(html, /<code [^>]*>код<\/code>/);
  assert.match(html, /<a href="https:\/\/projectsflow\.ru\/a\?b=1&amp;c=2"[^>]*>ссылкой<\/a>/);
  assert.match(html, /<br>/);
  assert.match(html, /<ul [^>]*><li [^>]*>один<\/li><li [^>]*>☑ сделано<\/li><\/ul>/);
  assert.match(html, /<ol /);
  assert.match(html, /<blockquote /);
  assert.match(html, /<hr /);
  assert.match(html, /<a href="https:\/\/projectsflow\.ru\/x"/);
  assert.ok(!html.includes('javascript:'), 'unsafe scheme is not linked');
  assert.ok(text.includes('• один'));
  assert.ok(text.includes('1. первый'));
  assert.ok(text.includes('ссылкой (https://projectsflow.ru/a?b=1&c=2)'));
  assert.ok(!text.includes('**'));
});

test('raw HTML in the body is escaped', () => {
  const { html } = renderMailingBody('<img src=x onerror=alert(1)> & "кавычки"', vars);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;кавычки&quot;'));
});

test('editor extras: colour spans, underline, highlight, escaped underscores, hard breaks', () => {
  const md = 'snake\\_case <span style="color:#d44c47">красный</span> ++под++ ==выд==\nстрока  \nещё\n\n<span style="color:red;position:fixed">чужой стиль</span>';
  const { html, text } = renderMailingBody(md, vars);
  assert.ok(html.includes('snake_case'));
  assert.ok(html.includes('<span style="color:#d44c47">красный</span>'));
  assert.ok(html.includes('<u>под</u>'));
  assert.match(html, /<mark [^>]*>выд<\/mark>/);
  assert.equal((html.match(/<br>/g) ?? []).length, 2);
  assert.ok(!html.includes('position'), 'unknown styles are dropped with their span');
  assert.ok(html.includes('чужой стиль'));
  assert.ok(text.startsWith('snake_case красный под выд\nстрока\nещё'));
});
