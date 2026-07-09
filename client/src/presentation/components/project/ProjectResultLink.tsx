import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContainer } from '@/infrastructure/di/container';
import { siteResultUrl } from '@/lib/publicBoardUrl';

// Ссылка «Результат» в шапке проекта → ЗАДЕПЛОЕННЫЙ статический сайт-результат на поддомене
// (<slug>.projectsflow.ru). Показываем только когда воркер уже что-то задеплоил (deployedAt).
// Адрес сайта (заглушка/результат) всегда доступен в плашке и во вкладке «Сайт проекта».
export function ProjectResultLink({ projectId }: { projectId: string }): React.ReactElement | null {
  const { projectRepository } = useContainer();
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    projectRepository
      .getProjectSite(projectId)
      .then((s) => {
        // Кнопка «Результат» — только для реально задеплоенного сайта (deployedAt).
        if (!cancelled) setSlug(s.deployedAt && s.siteSlug ? s.siteSlug : null);
      })
      .catch(() => {
        if (!cancelled) setSlug(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId]);

  if (!slug) return null;

  const url = siteResultUrl(slug);
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
