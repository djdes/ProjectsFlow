import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  children: ReactNode;
  // Опциональный кастомный fallback (например, локальный для kanban/дровера).
  fallback?: (reset: () => void) => ReactNode;
};

type State = { error: Error | null };

// Ловит throw в рендере любого потомка. Без него любая ошибка размонтирует всё дерево
// React → белый экран без действий. Корневой boundary оборачивает роутер; локальные
// можно ставить вокруг рискованных областей (окно задачи, доска), чтобы крэш одной
// части не убивал весь экран.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.reset);
      return (
        <div className="grid min-h-dvh place-items-center bg-background px-6">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold text-foreground">Что-то пошло не так</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Произошла непредвиденная ошибка. Попробуйте перезагрузить страницу — данные не
              потеряны.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button onClick={() => window.location.reload()}>Перезагрузить</Button>
              <Button variant="outline" onClick={this.reset}>
                Попробовать снова
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
