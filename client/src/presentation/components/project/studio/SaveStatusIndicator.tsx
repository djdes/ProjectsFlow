import * as React from 'react';
import { CloudAlert, CloudOff, RefreshCw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// В lucide 0.469 нет CloudCheck, поэтому собираем «облако с галочкой» сами:
// контур облака — из lucide (ISC, пакет уже в зависимостях), галочка дорисована
// в том же стиле (24×24, stroke-width 2, round caps), чтобы не выбиваться из набора.
function CloudCheck({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="m9 14.5 2 2 4-4" />
    </svg>
  );
}

// Состояние сохранения правок превью, поднятое из ProjectPreview в шапку левой панели.
//
// ВАЖНО про семантику: правка сохраняется на сервер СРАЗУ, как только применена. Поэтому
// «не сохранено» — это только патч в полёте или упавший запрос, а не накопленная пачка.
// Публикация (перенос правок в исходный код проекта с передеплоем) — отдельная тяжёлая
// операция и отдельное поле; она запускается вручную из «…»-меню, а не сама.
export type StudioSaveState = {
  // Есть ли активный режим правки — вне его индикатор не показываем.
  readonly editing: boolean;
  // Патч прямо сейчас летит на сервер.
  readonly saving: boolean;
  // Последняя ошибка сохранения, если была.
  readonly error: string | null;
  // Сохранённые правки, которые ещё не опубликованы в исходный код.
  readonly unpublished: number;
  // Диспетчер прямо сейчас публикует пачку.
  readonly publishing: boolean;
  // Когда последний раз успешно сохранили (epoch ms).
  readonly savedAt: number | null;
};

export const EMPTY_SAVE_STATE: StudioSaveState = {
  editing: false, saving: false, error: null, unpublished: 0, publishing: false, savedAt: null,
};

// «5 минут назад» / «в 14:03» — короткая подпись для тултипа.
function formatSavedAt(savedAt: number): string {
  const diffMs = Date.now() - savedAt;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  return `в ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function pluralEdits(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} правка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} правки`;
  return `${count} правок`;
}

// Индикатор сохранения в шапке левой панели Project Studio (паттерн из Base44).
// Это НЕ кнопка — статус. Кликать нечего: правки уходят на сервер сами при выходе
// из режима правки, поэтому элемент не фокусируется и не реагирует на курсор.
export function SaveStatusIndicator({ state }: { state: StudioSaveState }): React.ReactElement | null {
  // Вне режима правки статуса нет — как в Base44, где облачко появляется только в Edit mode.
  if (!state.editing) return null;

  const { icon: Icon, label, tone } = describe(state);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            // size-8, как у соседних кнопок хедера (тема, скрыть панель) — иначе
            // индикатор не встаёт с ними на одну линию.
            'grid size-8 shrink-0 place-items-center rounded-md',
            tone === 'error' ? 'text-destructive' : tone === 'dirty' ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground',
          )}
          role="status"
          aria-live="polite"
          aria-label={label}
        >
          <Icon className={cn('size-[18px]', state.saving && 'animate-spin motion-reduce:animate-none')} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function describe(state: StudioSaveState): {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: 'clean' | 'dirty' | 'error';
} {
  if (state.publishing) return { icon: RefreshCw, label: 'Диспетчер публикует правки в исходный код…', tone: 'dirty' };
  if (state.saving) return { icon: RefreshCw, label: 'Сохраняем правку…', tone: 'dirty' };
  if (state.error) return { icon: CloudOff, label: `Правка не сохранена: ${state.error}`, tone: 'error' };

  const saved = state.savedAt ? `Все правки сохранены ${formatSavedAt(state.savedAt)}` : 'Все правки сохранены';
  if (state.unpublished > 0) {
    // Сохранено, но ещё не перенесено в исходный код — предупреждаем, не пугаем.
    return { icon: CloudAlert, label: `${saved}. ${pluralEdits(state.unpublished)} ждут публикации — «…» → «Опубликовать правки»`, tone: 'dirty' };
  }
  return { icon: CloudCheck, label: saved, tone: 'clean' };
}
