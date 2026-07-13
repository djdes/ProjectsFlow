import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { UserAvatar } from './UserAvatar';

// Аватар с раскрытием при наведении: маленькая ава-триггер + всплывающая карточка «крупная ава +
// имя (+ подпись)». Тот же паттерн, что в окне активности (ActivityItem) — вынесен в переиспользуемый
// компонент для инбокс-карточек (делегирование) и ряда участников. Тултип-провайдер — глобальный
// (AppShell), отдельный не нужен.
export function UserAvatarHover({
  displayName,
  avatarUrl,
  subtitle,
  you = false,
  triggerClassName,
}: {
  displayName: string;
  avatarUrl?: string | null;
  // Строка под именем в раскрытии (напр. «поручил(а) вам», «выполняет»).
  subtitle?: string;
  // Пометить как текущего пользователя — добавляет «(вы)».
  you?: boolean;
  // Класс на маленькую аву-триггер (размер): по умолчанию size-5.
  triggerClassName?: string;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">
          <UserAvatar
            displayName={displayName}
            avatarUrl={avatarUrl}
            className={cn('size-5 text-[9px]', triggerClassName)}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={8}
        className="flex items-center gap-3 rounded-xl border-border/60 p-3 shadow-lg"
      >
        <UserAvatar displayName={displayName} avatarUrl={avatarUrl} className="size-11 text-base" />
        <span className="pr-1 text-left">
          <span className="block text-sm font-semibold text-foreground">
            {displayName}
            {you && <span className="font-normal text-muted-foreground"> (вы)</span>}
          </span>
          {subtitle && <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
