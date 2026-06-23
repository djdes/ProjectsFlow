import { useWorkspacesContext } from './WorkspacesProvider';

export function useSwitchWorkspace(): {
  switchTo: (id: string) => Promise<void>;
  switching: boolean;
} {
  const { switchTo, switching } = useWorkspacesContext();
  return { switchTo, switching };
}
