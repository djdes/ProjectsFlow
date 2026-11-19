// Поиск человека по тому, как его назвали в Telegram: «@Вася», «@Олегу», «@oleg», «@ivan_petrov»,
// «@Петров», «@v.ivanov» (почта). Чистая функция, без I/O.
//
// Раньше имя сравнивалось с отображаемым именем буквально (exact → prefix → substring), и
// живые формы не находились: «Вася» ≠ «Василий», «Олегу» ≠ «Олег», «oleg» ≠ «Олег»,
// «Пётр» ≠ «Петр». Здесь всё сводится к общему «скелету» (транслит, ё→е, без мягких знаков
// и удвоений), а уровни совпадения идут от точного к приблизительному:
//   1. полное имя или почта целиком;
//   2. каждое слово запроса совпало со словом имени (имя, фамилия, часть почты);
//   3. то же с учётом падежа или уменьшительной формы («Олегу», «Васе», «Саша»);
//   4. слово запроса — начало слова имени («Вас» → «Василий»);
//   5. подстрока всего имени (от 3 символов).
// Однозначный результат — единственный кандидат на самом сильном сработавшем уровне.

export type PersonCandidate = {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string | null;
};

export type PersonMatch<T> = {
  readonly unique: T | null;
  // Кандидаты для пикера: найденные на самом сильном уровне.
  readonly matches: readonly T[];
};

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Украинские и белорусские буквы встречаются в именах.
  і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u',
};

// Слово → «скелет»: латиница без вариантов записи. «Юлия» и «Yuliya» → «iulia»,
// «Алексей» и «Alexey» → «aleksei», «Пётр» и «Petr» → «petr».
export function skeleton(word: string): string {
  let s = '';
  for (const ch of word.toLocaleLowerCase('ru')) s += CYR_TO_LAT[ch] ?? ch;
  s = s
    .replace(/[^a-z0-9]/g, '')
    .replace(/kh/g, 'h')
    .replace(/x/g, 'ks')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/[yj]/g, 'i')
    .replace(/(.)\1+/g, '$1');
  return s;
}

// Основа без падежного окончания: «olegu» → «oleg», «vasei» → «vas», «irinoi» → «irin»,
// «petrovim» → «petrov». min — самая короткая основа (для уменьшительных хватает двух букв:
// «Ане» → «an» → «Анна»).
function stem(sk: string, min = 3): string {
  if (sk.length <= min) return sk;
  const cut = sk.replace(/(oi|ei|om|em|im|ami|ah)$/, '');
  const base = cut.length >= min && cut !== sk ? cut : sk;
  const trimmed = base.replace(/[aeiou]+$/, '');
  return trimmed.length >= min ? trimmed : base;
}

// Уменьшительные и разговорные формы → полное имя. Ключи и значения — в скелетах (по основам),
// поэтому «Васе», «Васи», «Васю» сводятся к той же «vas».
const DIMINUTIVES: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries({
    вася: ['василий'], петя: ['петр'], саша: ['александр', 'александра'], шура: ['александр'],
    женя: ['евгений', 'евгения'], дима: ['дмитрий'], митя: ['дмитрий'], миша: ['михаил'],
    коля: ['николай'], сережа: ['сергей'], серега: ['сергей'], леша: ['алексей'], алеша: ['алексей'],
    ваня: ['иван'], катя: ['екатерина'], настя: ['анастасия'], маша: ['мария'], лена: ['елена'],
    оля: ['ольга'], таня: ['татьяна'], юля: ['юлия'], аня: ['анна'], наташа: ['наталья', 'наталия'],
    витя: ['виктор'], паша: ['павел'], костя: ['константин'], толя: ['анатолий'], гриша: ['григорий'],
    слава: ['вячеслав', 'ярослав', 'святослав', 'владислав'], ира: ['ирина'], света: ['светлана'],
    вова: ['владимир'], володя: ['владимир'], влад: ['владислав', 'владимир'], рома: ['роман'],
    тема: ['артем'], лиза: ['елизавета'], даша: ['дарья'], ксюша: ['ксения'], надя: ['надежда'],
    вика: ['виктория'], галя: ['галина'], люда: ['людмила'], стас: ['станислав'], макс: ['максим'],
    боря: ['борис'], федя: ['федор'], гоша: ['георгий'], жора: ['георгий'], леня: ['леонид'],
    яна: ['янина'], поля: ['полина'], соня: ['софья', 'софия'], женька: ['евгений'], валера: ['валерий'],
    тоня: ['антонина'], дэн: ['денис'], денчик: ['денис'], никитос: ['никита'], ярик: ['ярослав'],
    кирюша: ['кирилл'], егорка: ['егор'], илюша: ['илья'], андрюша: ['андрей'], артемка: ['артем'],
    миха: ['михаил'], леха: ['алексей'], санек: ['александр'], вадик: ['вадим'], эдик: ['эдуард'],
    толик: ['анатолий'], юра: ['юрий'], гена: ['геннадий'], валя: ['валентина', 'валентин'],
    люба: ['любовь'], нина: ['нина'], рита: ['маргарита'], марина: ['марина'],
  }).map(([short, full]) => [stem(skeleton(short), 2), full.map((f) => skeleton(f))]),
);

function tokens(text: string): string[] {
  return text
    .split(/[\s_.\-,+@()]+/u)
    .map((t) => skeleton(t))
    .filter((t) => t.length > 0);
}

type Profile = { readonly full: string; readonly email: string | null; readonly words: readonly string[] };

function profileOf(c: PersonCandidate): Profile {
  const words = tokens(c.displayName);
  const local = c.email ? c.email.split('@')[0] ?? '' : '';
  const emailWords = local ? tokens(local) : [];
  return {
    full: words.join(''),
    email: local ? skeleton(local) : null,
    words: [...words, ...emailWords],
  };
}

// Уровень совпадения одного слова запроса со словом имени (меньше — сильнее); null — нет.
function wordLevel(q: string, w: string): number | null {
  if (q === w) return 2;
  const qs = stem(q);
  if (qs.length >= 3 && qs === stem(w)) return 3;
  // Уменьшительное — только для целого слова: «Ол» — это ещё не «Оля».
  const full = q.length >= 3 ? DIMINUTIVES[stem(q, 2)] : undefined;
  if (full?.includes(w) || full?.some((f) => stem(f) === stem(w))) return 3;
  if (q.length >= 2 && w.startsWith(q)) return 4;
  if (qs.length >= 3 && w.startsWith(qs)) return 4;
  return null;
}

function levelOf(query: string, queryWords: readonly string[], p: Profile): number | null {
  const whole = queryWords.join('');
  if (whole.length > 0 && (whole === p.full || (p.email !== null && whole === p.email))) return 1;
  // Каждое слово запроса должно найти своё слово имени; уровень кандидата — самый слабый.
  let worst = 0;
  const used = new Set<number>();
  for (const q of queryWords) {
    let best: { level: number; index: number } | null = null;
    p.words.forEach((w, index) => {
      if (used.has(index)) return;
      const level = wordLevel(q, w);
      if (level !== null && (!best || level < best.level)) best = { level, index };
    });
    if (!best) {
      worst = -1;
      break;
    }
    const found = best as { level: number; index: number };
    used.add(found.index);
    worst = Math.max(worst, found.level);
  }
  if (worst > 0) return worst;
  const sk = skeleton(query);
  if (sk.length >= 3 && (p.full.includes(sk) || (p.email?.includes(sk) ?? false))) return 5;
  return null;
}

export function matchPerson<T extends PersonCandidate>(query: string, candidates: readonly T[]): PersonMatch<T> {
  const queryWords = tokens(query);
  if (queryWords.length === 0) return { unique: null, matches: candidates };
  let bestLevel = Number.POSITIVE_INFINITY;
  let best: T[] = [];
  for (const c of candidates) {
    const level = levelOf(query, queryWords, profileOf(c));
    if (level === null) continue;
    if (level < bestLevel) {
      bestLevel = level;
      best = [c];
    } else if (level === bestLevel && !best.some((b) => b.id === c.id)) {
      best.push(c);
    }
  }
  return { unique: best.length === 1 ? best[0]! : null, matches: best };
}

// Упоминание человека без @username: Telegram присылает его не текстом «@ник», а сущностью
// text_mention с id пользователя. Бот подставляет в текст «@tgid:<id>», а поиск сверяет id с
// привязанными аккаунтами. Это самое надёжное совпадение — без угадывания по имени.
export const TG_ID_MENTION_PREFIX = 'tgid:';

export function telegramIdOfMention(query: string): number | null {
  const m = /^tgid:(\d{1,15})$/i.exec(query.trim());
  return m ? Number(m[1]) : null;
}

export type TelegramMessageEntity = {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly user?: { readonly id: number; readonly is_bot?: boolean; readonly first_name?: string };
};

// Человек без @username, выбранный в Telegram из подсказки, приходит в тексте просто именем
// («Иван Петров»), а кто это — только в сущности text_mention. Без неё бот не видел
// исполнителя вовсе. Заменяем такое имя на @-упоминание: привязанный к ProjectsFlow —
// «@tgid:<id>» (точное совпадение по аккаунту), остальные — «@Имя» (поиск по имени).
// Смещения сущностей — в UTF-16, как и индексы строк JS.
export async function inlineTextMentions(
  text: string,
  entities: readonly TelegramMessageEntity[] | undefined,
  isLinked: (telegramUserId: number) => Promise<boolean>,
): Promise<string> {
  const mentions = (entities ?? [])
    .filter((e) => e.type === 'text_mention' && e.user && !e.user.is_bot)
    .filter((e) => e.offset >= 0 && e.length > 0 && e.offset + e.length <= text.length)
    .sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const e of mentions) {
    const user = e.user!;
    let linked = false;
    try {
      linked = await isLinked(user.id);
    } catch {
      linked = false;
    }
    const shown = out.slice(e.offset, e.offset + e.length);
    const name = (user.first_name?.trim() || shown.trim()).split(/\s+/)[0]?.replace(/^@/, '') ?? '';
    const token = linked ? `@${TG_ID_MENTION_PREFIX}${user.id}` : name ? `@${name}` : shown;
    out = out.slice(0, e.offset) + token + out.slice(e.offset + e.length);
  }
  return out;
}
