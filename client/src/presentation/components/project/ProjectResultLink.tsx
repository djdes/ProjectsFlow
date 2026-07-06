import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';

// Ссылка «Результат» в шапке проекта → задеплоенный статический сайт на поддомене
// (<slug>.<домен>). Появляется только когда воркер уже что-то задеплоил (self-serve
// воркер-раннер, M3). Ссылка «есть только у владельца» (несекретный, но неиндексируемый slug).
export function ProjectResultLink({ projectId }: { projectId: string }): React.ReactElement | null {
  const { projectRepository } = useContainer();
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .getProjectSite(projectId)
      .then((s) => {
        if (!cancelled) setSlug(s?.slug ?? null);
      })
      .catch(() => {
        if (!cancelled) setSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId]);

  if (!slug) return null;

  const url = `https://${slug}.${window.location.host}`;
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
    >
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Результат">
        <Globe className="size-4" />
        <span className="text-sm">Результат</span>
      </a>
    </Button>
  );
}
