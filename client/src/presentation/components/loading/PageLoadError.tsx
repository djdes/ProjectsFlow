import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PageLoadError({
  onRetry = () => window.location.reload(),
}: {
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div role="alert" className="max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Не удалось загрузить страницу</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Проверьте подключение к интернету и попробуйте ещё раз.
        </p>
        <Button variant="outline" onClick={onRetry}>
          <RotateCw className="mr-2 size-4" />
          Попробовать снова
        </Button>
      </div>
    </div>
  );
}
