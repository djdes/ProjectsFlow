// Иконка Claude — восьмиконечная звезда (sparkle). currentColor → красится через
// CSS-класс родителя. Используется в карточке (badge «на уточнении») и в ленте
// комментариев (аватар agent-комментариев).
export function ClaudeIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z" />
    </svg>
  );
}
