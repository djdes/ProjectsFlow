import * as React from 'react';
import { CloudAlert, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Тёмный тултип — как в Base44. Глобальный TooltipContent светлый (bg-popover) и трогать
// его нельзя: он обслуживает ещё десяток мест. Поэтому красим точечно, здесь.
const DARK_TOOLTIP = 'max-w-[260px] border-transparent bg-neutral-900 text-white';

// В lucide 0.469 нет ни CloudCheck, ни CloudX, поэтому «облако с галочкой» и «облако с
// крестиком» собираем сами: контур облака — из lucide (ISC, пакет уже в зависимостях),
// метка дорисована в том же стиле (24×24, stroke-width 2, round caps), чтобы иконки не
// выбивались из набора. Ради двух глифов зависимость не обновляем.
const CLOUD_OUTLINE = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';

function CloudGlyph({ className, children }: { className?: string; children: React.ReactNode }): React.ReactElement {
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
      <path d={CLOUD_OUTLINE} />
      {children}
    </svg>
  );
}

function CloudCheck({ className }: { className?: string }): React.ReactElement {
  return (
    <CloudGlyph className={className}>
      <path d="m9 14.5 2 2 4-4" />
    </CloudGlyph>
  );
}

// Крестик занимает ту же клетку, что и галочка у CloudCheck, — иконки не «прыгают»
// при смене состояния.
function CloudX({ className }: { className?: string }): React.ReactElement {
  return (
    <CloudGlyph className={className}>
      <path d="m10 12.5 4 4" />
      <path d="m14 12.5-4 4" />
    </CloudGlyph>
  );
}

// Состояние сохранения правок превью, поднятое из ProjectPreview в шапку левой панели.
//
// Семантика «сохранено» здесь — пользовательская, а не техническая. Технически каждая
// правка уже лежит на сервере черновиком и переживает уход со страницы. Но для
// пользователя правка «сохранена» только когда она перенесена в исходный код проекта
// и тот пересобран, — а это происходит по повторному клику по Edit.
export type StudioSaveState = {
  // Есть ли активный режим правки — спокойные состояния показываем только в нём.
  readonly editing: boolean;
  // Патч прямо сейчас летит на сервер (черновик).
  readonly saving: boolean;
  // Последняя ошибка записи черновика, если была.
  readonly error: string | null;
  // Правки, ещё не перенесённые в проект. Для пользователя это «не сохранено».
  readonly unsaved: number;
  // Диспетчер прямо сейчас переносит правки в исходный код и пересобирает проект.
  readonly publishing: boolean;
  // Когда последний раз успешно сохранили в проект (epoch ms).
  readonly savedAt: number | null;
};

export const EMPTY_SAVE_STATE: StudioSaveState = {
  editing: false, saving: false, error: null, unsaved: 0, publishing: false, savedAt: null,
};

// «5 минут назад» / «в 14:03» — короткая подпись для тултипа.
function formatSavedAt(savedAt: number): string {
  const diffMs = Date.now() - savedAt;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  return `в ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

// Согласуем и существительное, и глагол: «1 правка не сохранена», «2 правки не
// сохранены», «5 правок не сохранено».
function unsavedPhrase(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} правка не сохранена`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} правки не сохранены`;
  return `${count} правок не сохранено`;
}

// Индикатор сохранения в шапке левой панели Project Studio (паттерн из Base44).
// Это НЕ кнопка — статус. Кликать нечего: правки уходят на сервер сами при выходе
// из режима правки, поэтому элемент не фокусируется и не реагирует на курсор.
export function SaveStatusIndicator({ state }: { state: StudioSaveState }): React.ReactElement | null {
  const busy = state.saving || state.publishing;
  // Сохранение и ошибку показываем ВСЕГДА: и вне режима правки, и на вкладке Dashboard.
  // Публикация идёт в фоне минутами — пользователь должен видеть, что процесс жив, а её
  // провал не должен пройти незаметно. Спокойные состояния («сохранено», «есть
  // несохранённые правки») остаются привязанными к режиму правки, как в Base44.
  if (!state.editing && !busy && !state.error) return null;

  const { icon: Icon, label, hint, tone } = describe(state);

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
          {/* Крутится и на записи черновика, и на публикации: иконка у них одна. */}
          <Icon className={cn('size-[18px]', busy && 'animate-spin motion-reduce:animate-none')} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className={DARK_TOOLTIP}>
        {label}
        {hint ? <span className="mt-0.5 block text-white/70">{hint}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function describe(state: StudioSaveState): {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  tone: 'clean' | 'dirty' | 'error';
} {
  // Ошибка идёт первой: провалившаяся публикация не должна прятаться за спиннером,
  // если счётчик очереди почему-то остался ненулевым.
  if (state.error) return { icon: CloudAlert, label: `Правку не удалось записать: ${state.error}`, tone: 'error' };
  if (state.publishing) return { icon: Loader2, label: 'Сохраняем правки в проект…', tone: 'dirty' };
  if (state.saving) return { icon: Loader2, label: 'Сохраняем…', tone: 'dirty' };
  if (state.unsaved > 0) {
    return {
      icon: CloudX,
      label: unsavedPhrase(state.unsaved),
      hint: 'Нажмите Edit ещё раз, чтобы сохранить в проект',
      tone: 'dirty',
    };
  }
  return {
    icon: CloudCheck,
    label: state.savedAt ? `Сохранено ${formatSavedAt(state.savedAt)}` : 'Сохранено',
    tone: 'clean',
  };
}
