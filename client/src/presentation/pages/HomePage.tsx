import { NewProjectButton } from '@/presentation/components/forms/NewProjectButton';

export function HomePage(): React.ReactElement {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Выберите проект</h1>
        <p className="text-sm text-muted-foreground">
          Откройте проект из&nbsp;сайдбара слева или&nbsp;создайте новый, чтобы начать.
        </p>
        <NewProjectButton className="gap-2" />
      </div>
    </div>
  );
}
