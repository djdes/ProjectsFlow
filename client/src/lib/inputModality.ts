// Чем человек сейчас управляет интерфейсом — указателем или клавиатурой. Пишем на <html>
// как data-pf-modality, и по нему в globals.css гасится фокус-кольцо.
//
// Зачем вообще: одного :focus-visible мало. Radix при закрытии меню/диалога возвращает
// фокус на кнопку-триггер программно (element.focus()), и браузер считает такой фокус
// «клавиатурным» — синее кольцо повисает на кнопке после обычного тапа или клика мышью.
// Именно это видно на «…» в сайдбаре: меню закрыли, а кнопка осталась обведённой.
//
// Убирать при этом кольцо совсем нельзя: без него человек с клавиатурой теряет курсор на
// странице. Поэтому решаем не «выключить фокус», а «показывать его только тому, кто ходит
// с клавиатуры»: указатель гасит кольцо, Tab/стрелки возвращают.
const MODALITY_ATTR = 'data-pf-modality';

// Клавиши, которые реально двигают фокус. Обычный ввод текста модальность не меняет —
// иначе набор в поле поиска зажигал бы кольца на кнопках вокруг.
const FOCUS_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
]);

export function trackInputModality(): void {
  const root = document.documentElement;
  // Стартуем с 'pointer': первое действие почти всегда клик или тап, а до него колец на
  // экране всё равно нет. Клавиатурщику модальность вернёт первый же Tab.
  root.setAttribute(MODALITY_ATTR, 'pointer');

  const setPointer = (): void => root.setAttribute(MODALITY_ATTR, 'pointer');
  const setKeyboard = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!FOCUS_KEYS.has(event.key)) return;
    root.setAttribute(MODALITY_ATTR, 'keyboard');
  };

  // capture: важно опередить обработчики, которые зовут focus() и останавливают всплытие.
  document.addEventListener('pointerdown', setPointer, true);
  document.addEventListener('keydown', setKeyboard, true);
}
