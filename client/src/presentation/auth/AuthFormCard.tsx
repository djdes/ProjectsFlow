import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

/**
 * Общая карточка для /login и /register — одинаковый layout (центр экрана,
 * фикс. ширина, тёмная/светлая тема). Сами поля и кнопки приходят в children.
 */
export function AuthFormCard({ title, description, children, footer }: Props): React.ReactElement {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
              aria-hidden="true"
            >
              PF
            </span>
            <span className="text-sm font-semibold tracking-tight">ProjectsFlow</span>
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
        <div className="border-t px-6 py-4 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      </Card>
    </div>
  );
}
