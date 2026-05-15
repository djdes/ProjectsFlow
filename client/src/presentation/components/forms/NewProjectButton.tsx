import { Plus } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useNewProjectDialog } from './NewProjectDialogProvider';

type NewProjectButtonProps = Omit<ButtonProps, 'onClick' | 'children'>;

/**
 * Единая кнопка «+ Новый проект». Любой клик открывает общий
 * `<NewProjectDialog>` через контекст `NewProjectDialogProvider`.
 * Класс/вариант передаются через props — layout определяет потребитель.
 */
export function NewProjectButton(props: NewProjectButtonProps): React.ReactElement {
  const { open } = useNewProjectDialog();
  return (
    <Button {...props} onClick={open}>
      <Plus />
      Новый проект
    </Button>
  );
}
