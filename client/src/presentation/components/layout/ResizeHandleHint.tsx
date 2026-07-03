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
}: {
  children: React.ReactElement;
  side?: 'left' | 'right';
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
            <span className="font-medium">Свернуть</span>{' '}
            <span className="text-white/55">Клик или Ctrl+\</span>
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
