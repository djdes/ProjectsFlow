import { useLayoutEffect, type RefObject } from 'react';

/**
 * Авто-рост textarea по содержимому. Site-wide правило: многострочные поля ввода
 * растут вместе с текстом до `maxRows` строк (по умолчанию 12), дальше включается
 * внутренний скролл. Поле никогда не ниже `minRows` строк (resting-вид сохраняется)
 * и никогда выше max(minRows, maxRows).
 *
 * Меряем реальные line-height / padding / border элемента и учитываем box-sizing,
 * поэтому работает одинаково для text-sm, монопространственного шрифта и т. п.
 *
 * @param ref     ref на сам <textarea> (объектный; callback-ref должен писать в .current)
 * @param value   текущее значение поля — пересчёт высоты на каждое изменение
 * @param options minRows (нижняя граница, по умолчанию 1), maxRows (потолок, по умолчанию 12)
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  options?: { minRows?: number; maxRows?: number },
): void {
  const minRows = options?.minRows ?? 1;
  const maxRows = options?.maxRows ?? 12;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const resize = (): void => {
      const cs = window.getComputedStyle(el);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const lineRaw = parseFloat(cs.lineHeight);
      // line-height:normal → NaN; аппроксимируем 1.4 от font-size.
      const line = Number.isFinite(lineRaw) ? lineRaw : fontSize * 1.4;
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const borderY =
        (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      const borderBox = cs.boxSizing === 'border-box';
      // Для border-box высота включает padding+border; для content-box — только контент.
      const extra = borderBox ? padY + borderY : 0;

      const cap = Math.max(minRows, maxRows);
      const minH = line * minRows + extra;
      const maxH = line * cap + extra;

      // Сброс высоты, чтобы scrollHeight посчитался без «застрявшей» высоты прошлого рендера.
      el.style.height = 'auto';
      // scrollHeight = контент + padding (без border). Приводим к нужному box-sizing.
      const content = borderBox ? el.scrollHeight + borderY : el.scrollHeight - padY;
      const next = Math.min(Math.max(content, minH), maxH);
      el.style.height = `${next}px`;
      el.style.overflowY = content > maxH ? 'auto' : 'hidden';
    };

    resize();
    // Смена ширины контейнера меняет перенос строк → пересчитать высоту.
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [ref, value, minRows, maxRows]);
}
