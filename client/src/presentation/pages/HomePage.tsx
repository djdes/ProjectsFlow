import { FolderOpen } from 'lucide-react';
import { NewProjectButton } from '@/presentation/components/forms/NewProjectButton';
import { WorkspaceCrumbs } from '@/presentation/layout/InboxBreadcrumbs';
import { PageTopBar } from '@/presentation/layout/PageChrome';
import { PageMessage } from '@/presentation/pages/PageScaffold';

export function HomePage(): React.ReactElement {
  return (
    <div className="flex min-h-full flex-col">
      <PageTopBar className="hidden sm:flex">
        <WorkspaceCrumbs icon={<FolderOpen className="size-3.5 shrink-0" />} label="Проекты" />
      </PageTopBar>
      <PageMessage
        className="min-h-0 flex-1"
        title="Выберите проект"
        description={<>Откройте проект из&nbsp;сайдбара слева или&nbsp;создайте новый, чтобы начать.</>}
      >
        <NewProjectButton className="gap-2" />
      </PageMessage>
    </div>
  );
}
