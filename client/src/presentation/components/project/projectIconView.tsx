import { cn } from '@/lib/utils';
import { LUCIDE_MAP, LUCIDE_COLOR_MAP } from './lucideIconList';

// Иконка проекта хранится в одном строковом поле `icon` тремя способами:
//   • эмодзи        — обычный юникод-символ («🚀»)
//   • lucide-иконка — префикс `lucide:` + имя из LUCIDE_MAP («lucide:Rocket»)
//   • картинка      — data-URL (загруженный файл) или http(s)/api-URL
// Хелперы ниже определяют тип, а <ProjectIconView> рендерит соответствующее представление.

const LUCIDE_PREFIX = 'lucide:';

export function isLucideIcon(icon: string): boolean {
  return icon.startsWith(LUCIDE_PREFIX);
}

export function isImageIcon(icon: string): boolean {
  return (
    icon.startsWith('data:') ||
    icon.startsWith('http://') ||
    icon.startsWith('https://') ||
    icon.startsWith('/')
  );
}

// `lucide:Rocket` → 'Rocket'; `lucide:Rocket:blue` → 'Rocket'.
export function lucideName(icon: string): string {
  return icon.slice(LUCIDE_PREFIX.length).split(':')[0];
}

// Цвет lucide-иконки (hex) или undefined (наследует цвет текста).
export function lucideColor(icon: string): string | undefined {
  const key = icon.slice(LUCIDE_PREFIX.length).split(':')[1];
  return key ? LUCIDE_COLOR_MAP[key] : undefined;
}

type Props = {
  icon: string;
  // Размер визуала в rem/px через классы — задаётся вызывающей стороной (по месту).
  className?: string;
  // Пиксельный размер для lucide/картинки (эмодзи масштабируется через className font-size).
  pixelSize?: number;
};

// Единая точка рендера иконки проекта. Возвращает <img>, lucide-компонент или эмодзи-текст.
export function ProjectIconView({ icon, className, pixelSize = 20 }: Props): React.ReactElement {
  if (isImageIcon(icon)) {
    return (
      <img
        src={icon}
        alt=""
        aria-hidden
        className={cn('block size-full rounded-[inherit] object-cover', className)}
      />
    );
  }
  if (isLucideIcon(icon)) {
    const Cmp = LUCIDE_MAP[lucideName(icon)];
    if (Cmp)
      return (
        <Cmp
          className={className}
          style={{ width: pixelSize, height: pixelSize, color: lucideColor(icon) }}
          aria-hidden
        />
      );
    // Неизвестное имя (иконка убрана из набора) — деградируем до текста-заглушки.
    return <span aria-hidden>▫️</span>;
  }
  // Эмодзи — размер задаётся через font-size в className.
  return (
    <span aria-hidden className={cn('block leading-none', className)}>
      {icon}
    </span>
  );
}
