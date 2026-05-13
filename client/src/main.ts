import "./styles.css";

type Project = {
  id: number;
  slug: string;
  title: string;
  year: number;
  period: string;
  category: string;
  summary: string;
  body: string;
  tags: string[];
  outcome: string | null;
  client: string | null;
  status: "live" | "archived" | "in-progress";
  sort_order: number;
};

const app = document.getElementById("app");
if (!app) throw new Error("#app root missing");

const tickerWords = [
  "история не пишется набело",
  "архив = инструмент",
  "каждый проект — глава",
  "помним всё, кроме скучного",
  "годы как разделы книги",
  "ретро без ностальгии",
];

const masthead = (): string => `
  <div class="ticker" aria-hidden="true">
    <div class="ticker__track">
      ${[...tickerWords, ...tickerWords]
        .map((w) => `<span class="ticker__item">${w}</span>`)
        .join("")}
    </div>
  </div>
  <header class="masthead">
    <div class="masthead__left">
      <span>Том&nbsp;I · 2017—${new Date().getFullYear()}</span>
      <span>Тираж: ∞</span>
    </div>
    <a class="masthead__logo" href="/" aria-label="ProjectsFlow">
      <span class="dot"></span>
      ProjectsFlow
    </a>
    <nav class="masthead__right">
      <a href="#chronology">Хронология</a>
      <a href="#colophon">Колофон</a>
    </nav>
  </header>
`;

const hero = (): string => {
  const title = (text: string): string =>
    [...text]
      .map((ch, i) =>
        ch === " "
          ? " "
          : `<span class="letter" style="animation-delay:${i * 22}ms">${ch}</span>`,
      )
      .join("");
  return `
    <section class="hero">
      <p class="hero__kicker"><span class="bar"></span> Архив инициатив, ${new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long" })}</p>
      <h1 class="hero__title">
        <span class="row">${title("История")}</span>
        <span class="row row--indent"><em>проектов,</em></span>
        <span class="row row--right">${title("которые")}</span>
        <span class="row">${title("остались")}</span>
      </h1>
      <div class="hero__lede">
        <p>
          С 2017&nbsp;года мы складываем сделанное не в&nbsp;портфолио, а&nbsp;в&nbsp;книгу. Здесь — главы:
          год, контекст, что сработало, что не&nbsp;очень. Без&nbsp;маркетинга, без&nbsp;кейсов
          в&nbsp;PDF&nbsp;— только хроника.
        </p>
        <aside>
          <b>Что это</b>
          лента с&nbsp;живой БД;<br/>
          обновляется без перезагрузки;<br/>
          источник правды — MySQL.
        </aside>
      </div>
      <div class="hero__stamp" aria-hidden="true">
        Архив<br/><b>№ 001</b><br/>живой
      </div>
    </section>
  `;
};

const metaStrip = (projects: Project[]): string => {
  const years = projects.map((p) => p.year);
  const minY = years.length ? Math.min(...years) : 2017;
  const maxY = years.length ? Math.max(...years) : new Date().getFullYear();
  const liveCount = projects.filter((p) => p.status === "live").length;
  const tagsCount = new Set(projects.flatMap((p) => p.tags)).size;

  const cell = (label: string, value: string, accent = false): string => `
    <div class="meta-strip__cell">
      <span class="meta-strip__label">${label}</span>
      <span class="meta-strip__value">${accent ? `<em>${value}</em>` : value}</span>
    </div>
  `;

  return `
    <section class="meta-strip" aria-label="Сводка">
      ${cell("Глав в книге", String(projects.length).padStart(2, "0"))}
      ${cell("Период", `${minY}—${maxY}`, true)}
      ${cell("В работе сейчас", String(liveCount).padStart(2, "0"))}
      ${cell("Уникальных тегов", String(tagsCount).padStart(2, "0"))}
    </section>
  `;
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const entry = (p: Project, idx: number, total: number): string => {
  const statusLabel = {
    live: "в проде",
    archived: "архив",
    "in-progress": "в работе",
  }[p.status];

  const number = String(total - idx).padStart(3, "0");

  return `
    <article class="entry" data-status="${p.status}">
      <div class="entry__year" data-period="${escapeHtml(p.period)}">${p.year}</div>
      <div class="entry__body">
        <div class="entry__header">
          <span class="entry__no">№ ${number}</span>
          <span class="entry__status" data-status="${p.status}">${statusLabel}</span>
          ${p.client ? `<span>для&nbsp;${escapeHtml(p.client)}</span>` : ""}
        </div>
        <h3 class="entry__title">${escapeHtml(p.title)}</h3>
        <p class="entry__summary">${escapeHtml(p.summary)}</p>
        <p class="entry__text">${escapeHtml(p.body)}</p>
        <div class="entry__footer">
          <div class="entry__tags">
            ${p.tags.map((t) => `<span class="entry__tag">${escapeHtml(t)}</span>`).join("")}
          </div>
          ${p.outcome ? `<span class="entry__outcome">→ ${escapeHtml(p.outcome)}</span>` : ""}
          <span class="entry__category">${escapeHtml(p.category)}</span>
        </div>
      </div>
    </article>
  `;
};

const chronology = (projects: Project[]): string => {
  if (projects.length === 0) {
    return `
      <section class="chronology" id="chronology">
        <div class="note">
          База пуста. Запусти <b>npm run db:seed</b>, чтобы появились первые главы.
        </div>
      </section>
    `;
  }
  const total = projects.length;
  return `
    <section class="chronology" id="chronology">
      <div class="chronology__intro">
        <h2>Хронология — <em>от&nbsp;нового к&nbsp;старому.</em></h2>
        <p>
          Лента листается сверху вниз. Свежие записи — наверху, начало пути — внизу.
          Если глава помечена «в&nbsp;проде», проект до&nbsp;сих пор живёт.
          «В&nbsp;работе» — пишется прямо сейчас.
        </p>
      </div>
      <div class="timeline-state">
        <span class="pulse" aria-hidden="true"></span>
        Подключение к&nbsp;БД активно · ${total} ${pluralRu(total, ["глава", "главы", "глав"])}
      </div>
      <div class="entries">
        ${projects.map((p, i) => entry(p, i, total)).join("")}
      </div>
    </section>
  `;
};

const colophon = (): string => `
  <footer class="colophon" id="colophon">
    <div class="colophon__left">
      <h3>Книга не&nbsp;закрыта — пишется прямо сейчас.</h3>
      <p>
        ProjectsFlow ведёт открытый архив с&nbsp;${new Date().getFullYear() - 2017}+&nbsp;лет.
        Это не&nbsp;портфолио и&nbsp;не&nbsp;витрина: каждая глава попадает сюда
        после того, как закрыта на&nbsp;ретро.
      </p>
    </div>
    <div class="colophon__right">
      <div class="colophon__col">
        <h4>Стек</h4>
        <ul>
          <li>Node.js · Express</li>
          <li>MariaDB · mysql2</li>
          <li>Vite · TypeScript</li>
          <li>nginx + PM2</li>
        </ul>
      </div>
      <div class="colophon__col">
        <h4>Связь</h4>
        <ul>
          <li><a href="mailto:hello@projectsflow.ru">hello@projectsflow.ru</a></li>
          <li><a href="/api/projects">JSON-лента /api/projects</a></li>
          <li><a href="/api/health">health-чек</a></li>
        </ul>
      </div>
      <div class="colophon__bottom">
        <span>© ${new Date().getFullYear()} ProjectsFlow · projectsflow.ru</span>
        <span>Свёрстано в&nbsp;Vite · подаётся Express</span>
      </div>
    </div>
  </footer>
`;

const skeleton = (): string => `
  <section class="chronology">
    <div class="skeleton" aria-label="Загрузка хронологии" aria-busy="true">
      ${Array.from({ length: 4 })
        .map(
          () => `
        <div class="skeleton__row">
          <div class="skeleton__year"></div>
          <div>
            <div class="skeleton__line"></div>
            <div class="skeleton__line s2"></div>
            <div class="skeleton__line s3"></div>
          </div>
        </div>`,
        )
        .join("")}
    </div>
  </section>
`;

const errorView = (msg: string): string => `
  <section class="chronology">
    <div class="note">
      Не&nbsp;удалось загрузить хронику: <b>${escapeHtml(msg)}</b><br/>
      Проверь, что сервер запущен и&nbsp;БД доступна.
    </div>
  </section>
`;

const pluralRu = (n: number, forms: [string, string, string]): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
};

const render = (inner: string): void => {
  app.innerHTML = `${masthead()}<main>${inner}</main>${colophon()}`;
};

const observeEntries = (): void => {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  document.querySelectorAll<HTMLElement>(".entry").forEach((el) => io.observe(el));
};

const load = async (): Promise<void> => {
  render(`${hero()}${skeleton()}`);
  try {
    const r = await fetch("/api/projects", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { projects: Project[] };
    render(`${hero()}${metaStrip(data.projects)}${chronology(data.projects)}`);
    requestAnimationFrame(observeEntries);
  } catch (err) {
    render(`${hero()}${errorView((err as Error).message)}`);
  }
};

void load();
