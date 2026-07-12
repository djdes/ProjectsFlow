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
    <section className="border-t pt-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-medium">{title}</h2>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
