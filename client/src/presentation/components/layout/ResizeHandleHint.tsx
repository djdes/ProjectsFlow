import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// Чёрная подсказка «как в Notion» на границе-ресайзере: «Свернуть — клик/Ctrl+\,
// изменить ширину — тяните». Оборачивает саму ручку (children = триггер).
// Единый вид для всех ресайзеров сайта (левая панель, окно задачи и т.д.).
export function ResizeHandleHint({
  children,
  side = 'right',
  action = 'Свернуть',
  shortcut = 'Клик или Ctrl+\\',
}: {
  children: React.ReactElement;
  side?: 'left' | 'right';
  // Верхняя строка подсказки — что делает клик по границе (панель: «Свернуть», окно: «Закрыть»).
  action?: string;
  shortcut?: string;
}): React.ReactElement {
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          avoidCollisions={false}
          className="border-transparent bg-neutral-900 text-white dark:bg-neutral-800"
        >
          <div>
            <span className="font-medium">{action}</span>{' '}
            <span className="text-white/55">{shortcut}</span>
          </div>
          <div>
            <span className="font-medium">Изменить ширину</span>{' '}
            <span className="text-white/55">Тяните</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
