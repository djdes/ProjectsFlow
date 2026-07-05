// Генератор публичного slug доски (Publish to web, db/096). Формат `adjective-noun-token`
// — как в Notion (напр. cookie-opinion-k3f9q2): читаемо, но неугадываемо.
//
// Slug — это capability: сама ссылка = доступ. Но доска и так публичная по замыслу
// (owner нажал Publish), поэтому задача хвоста — не защита секретов, а защита от
// перебора/энумерации. 6 base36-символов + выбор adj/noun дают ~50+ бит — достаточно,
// чтобы slug нельзя было угадать/перебрать. Уникальность обеспечивает UNIQUE-индекс +
// retry в PublishProject (не этот генератор).

// Короткие «дружелюбные» слова (без коллизий смыслов/мата). Английские — slug в URL.
const SLUG_ADJECTIVES = [
  'cookie', 'silent', 'gentle', 'brave', 'lunar', 'amber', 'swift', 'quiet',
  'sunny', 'misty', 'clever', 'noble', 'happy', 'lucky', 'cosmic', 'velvet',
  'golden', 'crisp', 'mellow', 'vivid', 'calm', 'bold', 'fuzzy', 'jolly',
];

const SLUG_NOUNS = [
  'opinion', 'harbor', 'meadow', 'canyon', 'lantern', 'pebble', 'willow', 'ember',
  'ripple', 'thicket', 'beacon', 'summit', 'orchard', 'anchor', 'cobble', 'marble',
  'feather', 'garden', 'island', 'pocket', 'ribbon', 'saddle', 'tundra', 'walnut',
];

const TOKEN_LEN = 6;

function pick<T>(arr: readonly T[], rng: () => number): T {
  // clamp: rng() ∈ [0,1); при 0.9999999 * len округляем вниз, границу не переходим.
  const i = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
  return arr[i]!;
}

export function generatePublicSlug(rng: () => number = Math.random): string {
  const adj = pick(SLUG_ADJECTIVES, rng);
  const noun = pick(SLUG_NOUNS, rng);
  let token = '';
  for (let i = 0; i < TOKEN_LEN; i += 1) {
    token += Math.min(35, Math.floor(rng() * 36)).toString(36);
  }
  return `${adj}-${noun}-${token}`;
}
