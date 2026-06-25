import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';

// Единый аватар пользователя для всего приложения (сайдбар, настройки, …): фото по
// avatarUrl, иначе цветной чип с инициалами (детерминированный цвет по имени — один и
// тот же человек всегда одного цвета). Так аватар выглядит ОДИНАКОВО везде.
export function UserAvatar({
  displayName,
  avatarUrl,
  className,
}: {
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}): React.ReactElement {
  // rounded-[25%] — скруглённый квадрат как в Notion (не круг), размер-независимо.
  return (
    <Avatar className={cn('shrink-0 rounded-[25%]', className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" />}
      <AvatarFallback className={cn('rounded-[25%] font-semibold', avatarColor(displayName))}>
        {getInitials(displayName)}
      </AvatarFallback>
    </Avatar>
  );
}
