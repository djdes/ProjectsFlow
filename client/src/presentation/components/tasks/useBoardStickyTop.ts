import { useEffect, useState } from 'react';

// Высота элемента, только если он реально закреплён (position: sticky) и виден.
function stickyHeight(id: string): number {
  const el = document.getElementById(id);
  if (!el || getComputedStyle(el).position !== 'sticky') return 0;
  return el.offsetHeight;
}

// Высота собственного липкого «стека» страницы проекта внутри <main>: строка крошек
// (#pf-project-crumbs) или её мобильная замена (#pf-project-mobile-header) плюс плашки
// (#pf-sticky-banners). Каждый слой считается, только пока он реально закреплён: на телефоне
// мобильная строка проекта и плашки обычные (уезжают со страницей), и прибавлять их высоту
// к линии закрепления значило бы прятать шапки колонок/таблицы ниже, чем нужно.
export function stickyStackHeight(): number {
  return (
    Math.max(stickyHeight('pf-project-crumbs'), stickyHeight('pf-project-mobile-header')) +
    stickyHeight('pf-sticky-banners')
  );
}

// Вертикальный офсет (в координатах вьюпорта), на котором закрепляются шапки колонок
// канбана при скролле страницы.
//
// Доска скроллится внутри <main> оболочки, поэтому линия закрепления начинается от
// верхней кромки main (на мобиле она не равна нулю: выше живут шапка приложения и
// плашка установки PWA) и растёт на высоту собственных sticky-строк страницы —
// крошек проекта (#pf-project-crumbs / #pf-project-mobile-header) и плашек
// (#pf-sticky-banners). На страницах без этих строк (например «Входящие») остаётся
// только верх main.
export function useBoardStickyTop(): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const main = document.querySelector('main');
    const measure = (): void => {
      // Элементы читаем на каждом замере: плашки закрываются, крошки прячутся на мобиле.
      const mainTop = main ? Math.max(0, main.getBoundingClientRect().top) : 0;
      setTop(Math.round(mainTop + stickyStackHeight()));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    // Наблюдаем только за реально существующими элементами — по одной подписке на маунт.
    [main, document.getElementById('pf-project-crumbs'), document.getElementById('pf-project-mobile-header'),
      document.getElementById('pf-sticky-banners')]
      .forEach((el) => {
        if (el) observer?.observe(el);
      });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return top;
}
