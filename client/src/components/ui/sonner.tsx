import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/presentation/components/theme/ThemeProvider';

export function Toaster(props: ToasterProps): React.ReactElement {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      // richColors включает семантическую раскраску:
      // success — зелёный + ✓, error — красный + ✕, warning — янтарный, info — синий.
      richColors
      closeButton
      mobileOffset={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))', left: 12, right: 12 }}
      visibleToasts={3}
      className="toaster group"
      toastOptions={{
        classNames: {
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
