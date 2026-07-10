// @projectsflow/app-client — тонкий клиент к App Runtime приложения проекта.
//
// Встраивается КАК ЕСТЬ в сгенерированный статический сайт (`<slug>.projectsflow.ru`):
// это чистый ESM без зависимостей и без шага сборки — браузер исполняет файл напрямую.
// Приложение обслуживается со своего поддомена и ходит в тот же origin (`/api/*`), поэтому
// `baseUrl` по умолчанию пустой (относительные пути).
//
// API:
//   const pf = createClient();                       // same-origin
//   await pf.auth.signUp(email, password);
//   await pf.auth.signIn(email, password);
//   const me = await pf.auth.user();                 // { id, email } | null
//   await pf.auth.signOut();
//   const rows = await pf.from('posts').select({ filter: { owner_id: me.id }, sort: 'created_at', dir: 'desc', limit: 20 });
//   const row  = await pf.from('posts').insert({ title: 'Привет' });
//   await pf.from('posts').update(row.id, { title: 'Правка' });
//   await pf.from('posts').delete(row.id);

/**
 * @typedef {Object} AppUser
 * @property {string} id
 * @property {string} email
 */

/**
 * @typedef {Object} SelectOpts
 * @property {Record<string, unknown>} [filter]  Равенство по полям (owner_id/id тоже допустимы).
 * @property {string} [sort]                      Имя поля для сортировки.
 * @property {'asc'|'desc'} [dir]                 Направление сортировки (по умолчанию asc).
 * @property {number} [limit]
 * @property {number} [offset]
 */

// Ошибка запроса к App Runtime: несёт HTTP-статус и машинный код (`user_exists`, `auth_failed`,
// `access_denied`, `storage_full`, `bad_request`, `not_provisioned`).
export class AppClientError extends Error {
  /** @param {number} status @param {string} code @param {string} [message] */
  constructor(status, code, message) {
    super(message || code);
    this.name = 'AppClientError';
    this.status = status;
    this.code = code;
  }
}

// Хранилище токена: localStorage в браузере, иначе — память (SSR/тесты). Ключ привязан к baseUrl,
// чтобы несколько клиентов на странице не путали токены.
function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* доступ к localStorage может бросать (iframe, приватный режим) */
  }
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

/**
 * @param {string} [baseUrl]  База API (напр. '' для same-origin или 'https://slug.projectsflow.ru').
 * @param {string} [appKey]   Публичный ключ приложения (резерв; шлётся как X-App-Key).
 * @param {{ fetch?: typeof fetch, storage?: { getItem(k:string):(string|null), setItem(k:string,v:string):void, removeItem(k:string):void } }} [opts]
 */
export function createClient(baseUrl = '', appKey = '', opts = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) throw new Error('app-client: fetch недоступен — передайте opts.fetch');
  const storage = opts.storage || defaultStorage();
  const tokenKey = `pf_app_token:${base}`;

  const getToken = () => storage.getItem(tokenKey);
  const setToken = (t) => (t ? storage.setItem(tokenKey, t) : storage.removeItem(tokenKey));

  /** @param {string} path @param {{ method?: string, query?: Record<string, unknown>, body?: unknown }} [o] */
  async function request(path, o = {}) {
    let url = base + path;
    if (o.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(o.query)) {
        if (v !== undefined && v !== null) qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    /** @type {Record<string,string>} */
    const headers = {};
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (appKey) headers['X-App-Key'] = appKey;
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await doFetch(url, {
      method: o.method || 'GET',
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const code = (data && data.error) || 'request_failed';
      const msg = (data && data.message) || undefined;
      throw new AppClientError(res.status, code, msg);
    }
    return data;
  }

  const auth = {
    /** @returns {Promise<AppUser>} */
    async signUp(email, password) {
      const r = await request('/api/auth/signup', { method: 'POST', body: { email, password } });
      setToken(r.token);
      return r.user;
    },
    /** @returns {Promise<AppUser>} */
    async signIn(email, password) {
      const r = await request('/api/auth/signin', { method: 'POST', body: { email, password } });
      setToken(r.token);
      return r.user;
    },
    async signOut() {
      try {
        await request('/api/auth/signout', { method: 'POST' });
      } finally {
        setToken(null);
      }
    },
    /** @returns {Promise<AppUser|null>} */
    async user() {
      if (!getToken()) return null;
      const r = await request('/api/auth/me');
      return r.user;
    },
  };

  /** @param {string} table */
  function from(table) {
    const t = encodeURIComponent(table);
    return {
      /** @param {SelectOpts} [o] @returns {Promise<Record<string, unknown>[]>} */
      select(o = {}) {
        return request(`/api/data/${t}`, {
          query: { ...(o.filter || {}), sort: o.sort, dir: o.dir, limit: o.limit, offset: o.offset },
        });
      },
      /** @param {Record<string, unknown>} values */
      insert(values) {
        return request(`/api/data/${t}`, { method: 'POST', body: values });
      },
      /** @param {string} id @param {Record<string, unknown>} values */
      update(id, values) {
        return request(`/api/data/${t}/${encodeURIComponent(id)}`, { method: 'PATCH', body: values });
      },
      /** @param {string} id */
      delete(id) {
        return request(`/api/data/${t}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
    };
  }

  return { auth, from, get token() { return getToken(); } };
}
