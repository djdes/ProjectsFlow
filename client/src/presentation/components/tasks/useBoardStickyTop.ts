import { useEffect, useState } from 'react';

// Вертикальный офсет (в координатах вьюпорта), на котором закрепляются шапки колонок
// канбана при скролле. Панель доски берёт из него свою высоту (`100dvh - offset`), а
// закрепляет шапки уже сам браузер — нативным `position: sticky` внутри панели.
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
      const crumbs = document.getElementById('pf-project-crumbs');
      const mobileHeader = document.getElementById('pf-project-mobile-header');
      const banners = document.getElementById('pf-sticky-banners');
      const mainTop = main ? Math.max(0, main.getBoundingClientRect().top) : 0;
      const headerHeight = Math.max(crumbs?.offsetHeight ?? 0, mobileHeader?.offsetHeight ?? 0);
      setTop(Math.round(mainTop + headerHeight + (banners?.offsetHeight ?? 0)));
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
