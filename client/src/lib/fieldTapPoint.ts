// Куда пришёлся тап по полю ввода. Фокус поля в globals.css «расцветает» оттуда, куда ткнул
// палец (заливка акцента расходится кругом от точки и гаснет), а не из центра — поле отвечает
// именно на это касание. Точку кладём на само поле (или на капсулу, в которой оно живёт:
// композер комментария, ИИ, поиск) как --pf-tap-x / --pf-tap-y в пикселях от его угла.
// С клавиатуры (Tab) точки нет — круг пойдёт из центра (значения по умолчанию в CSS).

const FIELD_SELECTOR = [
  '.pf-field-capsule',
  '.pf-comment-composer-card',
  'textarea',
  'input:not([type])',
  "input[type='text']",
  "input[type='search']",
  "input[type='email']",
  "input[type='password']",
  "input[type='url']",
  "input[type='tel']",
  "input[type='number']",
].join(', ');

const CAPSULE_SELECTOR = '.pf-field-capsule, .pf-comment-composer-card';

export function trackFieldTapPoint(): void {
  const mark = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const field = target.closest(FIELD_SELECTOR);
    if (!(field instanceof HTMLElement)) return;
    // Поле внутри капсулы — светится капсула (у неё :focus-within), точка нужна ей.
    const surface = (field.closest(CAPSULE_SELECTOR) as HTMLElement | null) ?? field;
    const rect = surface.getBoundingClientRect();
    surface.style.setProperty('--pf-tap-x', `${Math.round(event.clientX - rect.left)}px`);
    surface.style.setProperty('--pf-tap-y', `${Math.round(event.clientY - rect.top)}px`);
  };
  // capture: точка должна лечь раньше, чем фокус запустит анимацию.
  document.addEventListener('pointerdown', mark, true);
}
