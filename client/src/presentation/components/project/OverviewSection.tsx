type Props = {
  icon?: React.ReactNode;
  title: string;
  // Правый слот строки заголовка — кнопки-действия секции.
  actions?: React.ReactNode;
  children: React.ReactNode;
};

// Плоская секция обзора проекта (замена shadcn Card): строка заголовка + контент.
// Разделение секций — border-t; отступы между ними задаёт space-y контейнера страницы.
export function OverviewSection({ icon, title, actions, children }: Props): React.ReactElement {
  return (
    <section className="border-bs pbs-5">
      {/* Wraps: on a 320px phone a long action («Настройки пространства») must drop under
          the title instead of sticking out past the screen edge. */}
      <div className="mbe-3 flex flex-wrap items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium">{title}</h2>
        {actions && <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
