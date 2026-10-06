import path from 'node:path';

// Граница рабочей папки для codex на машине диспетчера. Хук PreToolUse codex видит только
// текст команды, а папку запуска (`workdir`) и оболочку (`shell`) у exec_command не видит.
// Все ответы модели идут через наш шлюз, поэтому вызовы проверяются здесь, до того как их
// получит codex. Нарушение превращается в вызов несуществующего инструмента: codex отвечает
// модели «unsupported call: blocked_by_projectsflow__…» и ничего не запускает.

export const BLOCKED_TOOL_PREFIX = 'blocked_by_projectsflow__';

// Оболочки, синтаксис которых понимает workspace-guard на машине диспетчера. Только имя:
// путь к исполняемому файлу позволил бы запустить что угодно под видом оболочки.
const ALLOWED_SHELLS = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'cmd', 'cmd.exe']);
// Параметры «папка запуска» у инструментов codex (exec_command, shell, local_shell).
const WORKDIR_KEYS = ['workdir', 'cwd', 'working_directory'] as const;

export type ToolCallViolation = 'workdir_outside_workspace' | 'shell_not_allowed';

// item — элемент вывода модели из события response.output_item.done. Возвращает замену
// элемента, если вызов нарушает границу, иначе null.
export function blockToolCallOutsideWorkspace(
  item: unknown,
  workspaceRoot: string | null,
): { readonly item: Record<string, unknown>; readonly violation: ToolCallViolation } | null {
  if (!isRecord(item)) return null;
  let args: Record<string, unknown> | null = null;
  if (item['type'] === 'function_call') args = parseArguments(item['arguments']);
  else if (item['type'] === 'local_shell_call' && isRecord(item['action'])) args = item['action'];
  if (!args) return null;

  const violation = findViolation(args, workspaceRoot);
  if (!violation) return null;
  return {
    violation,
    item: {
      type: 'function_call',
      id: item['id'],
      call_id: item['call_id'],
      name: BLOCKED_TOOL_PREFIX + violation,
      arguments: '{}',
      status: 'completed',
    },
  };
}

function findViolation(args: Record<string, unknown>, root: string | null): ToolCallViolation | null {
  for (const key of WORKDIR_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '' && !isInsideWorkspace(value.trim(), root)) {
      return 'workdir_outside_workspace';
    }
  }
  const shell = args['shell'];
  if (typeof shell === 'string' && shell.trim() !== '' && !ALLOWED_SHELLS.has(shell.trim().toLowerCase())) {
    return 'shell_not_allowed';
  }
  return null;
}

// Пути Windows: codex работает на машине диспетчера. Без корня любой workdir запрещён.
export function isInsideWorkspace(workdir: string, root: string | null): boolean {
  if (!root || !/^[a-z]:[\\/]/i.test(root)) return false;
  // UNC и пути устройств (\\server\share, \\?\C:\…) и «C:foo» (относительно текущей папки
  // диска) не разбираем — запрещаем.
  if (/^[\\/]{2}/.test(workdir) || /^[a-z]:(?![\\/])/i.test(workdir)) return false;
  const base = path.win32.resolve(root).replace(/\\+$/, '').toLowerCase();
  const target = path.win32.resolve(base, workdir).replace(/\\+$/, '').toLowerCase();
  return target === base || target.startsWith(base + '\\');
}

function parseArguments(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // codex не исполнит вызов с битым JSON — пропускаем как есть.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
