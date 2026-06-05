// Markdown (app-диалект GFM) → HTML, который понимает Telegram при вставке из буфера.
//
// Используется кнопкой «Копировать для Telegram» и пунктом меню форматирования: текст из
// поля задачи кладётся в буфер как text/html, и при вставке в Telegram (desktop/mobile)
// применяется вёрстка — жирный, курсив, подчёркнутый, зачёркнутый, моноширинный, цитата,
// ссылки, переносы строк. Списки у Telegram не имеют сущности → рендерим текстом (• / N.).
//
// ЗЕРКАЛО серверного конвертера `server/src/domain/task/digestFormat.ts` (`markdownToRich`,
// режим 'telegram') + добавлены ~~зачёркнутый~~, <u>подчёркнутый</u>, > цитата. При правке
// форматов держи оба файла в синхроне (см. Решение 4 в плане).
//
// Telegram HTML понимает теги: <b> <i> <u> <s> <code> <pre> <a> <blockquote> <tg-spoiler>.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Инлайн-markdown одной строки → безопасный HTML. Экранируем ПЕРВЫМ (теги всегда
// сбалансированы), затем восстанавливаем сырой <u> (его пишет меню — в markdown подчёркивания
// нет), потом ссылки/жирный/зачёркнутый/код/курсив.
function inlineMd(s: string): string {
  let t = escapeHtml(s);
  // Восстановить парный <u>…</u> (контент внутри остаётся экранированным — XSS-безопасно).
  t = t.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  t = t.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  t = t.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  t = t.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>');
  return t;
}

export function mdToTelegramHtml(md: string): string {
  const lines = (md ?? '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let inCode = false;
  let code: string[] = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inCode) {
        inCode = true;
        code = [];
      } else {
        inCode = false;
        out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const t = line.trim();
    if (t === '') {
      out.push('');
      continue;
    }

    const h = /^(#{1,6})\s+(.+)$/.exec(t);
    if (h) {
      out.push(`<b>${inlineMd(h[2]!)}</b>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(t);
    if (quote) {
      out.push(`<blockquote>${inlineMd(quote[1]!)}</blockquote>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.+)$/.exec(t);
    if (bullet) {
      out.push(`• ${inlineMd(bullet[1]!)}`);
      continue;
    }

    const num = /^(\d+)\.\s+(.+)$/.exec(t);
    if (num) {
      out.push(`${num[1]}. ${inlineMd(num[2]!)}`);
      continue;
    }

    out.push(inlineMd(t));
  }
  if (inCode) out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);

  // <br> между строками — в буфере text/html браузер схлопывает «сырые» переносы строк,
  // поэтому переносы делаем явными, чтобы Telegram сохранил разбивку. Блочные <pre>/<blockquote>
  // ломают строку сами, лишний <br> рядом для Telegram некритичен.
  return out.join('<br>');
}
