import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PageMessage } from '@/presentation/pages/PageScaffold';

export function NotFoundPage(): React.ReactElement {
  return (
    <PageMessage eyebrow="404" title={<>Страница не&nbsp;найдена</>}>
      <Button asChild variant="outline">
        <Link to="/">На&nbsp;главную</Link>
      </Button>
    </PageMessage>
  );
}
