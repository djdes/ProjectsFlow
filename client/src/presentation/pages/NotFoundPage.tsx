import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage(): React.ReactElement {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-2xl font-semibold">Страница не&nbsp;найдена</h1>
        <Button asChild variant="outline">
          <Link to="/">На&nbsp;главную</Link>
        </Button>
      </div>
    </div>
  );
}
