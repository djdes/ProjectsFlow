import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/presentation/components/theme/ThemeProvider';

const SONNER_VARS = {
  '--normal-bg': 'oklch(var(--popover))',
  '--normal-text': 'oklch(var(--popover-foreground))',
  '--normal-border': 'oklch(var(--border))',
  '--success-bg': 'var(--sonner-success-bg)',
  '--success-text': 'var(--sonner-success-fg)',
  '--success-border': 'var(--sonner-success-bg)',
  '--error-bg': 'var(--sonner-error-bg)',
  '--error-text': 'var(--sonner-error-fg)',
  '--error-border': 'var(--sonner-error-bg)',
  '--info-bg': 'var(--sonner-info-bg)',
  '--info-text': 'var(--sonner-info-fg)',
  '--info-border': 'var(--sonner-info-bg)',
  '--warning-bg': 'var(--sonner-warning-bg)',
  '--warning-text': 'var(--sonner-warning-fg)',
  '--warning-border': 'var(--sonner-warning-bg)',
  '--border-radius': '10px',
} as React.CSSProperties;

export function Toaster(props: ToasterProps): React.ReactElement {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      // richColors включает семантическую раскраску:
      // success — зелёный + ✓, error — красный + ✕, warning — янтарный, info — синий.
      richColors
      closeButton
      mobileOffset={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom,0px))', left: 12, right: 12 }}
      visibleToasts={3}
      className="toaster group"
      // Цвета richColors — из палитры статусов (globals.css, --sonner-*): непрозрачные
      // плашки «готово» зелёным, ошибки красным, инфо синим, предупреждения янтарным.
      style={SONNER_VARS}
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
