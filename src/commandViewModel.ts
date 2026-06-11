import { CommandDefinition, CommandGroup, CommandStatus, ExecutionStatus } from './types';

export const STATUS_ICONS: Record<ExecutionStatus, { icon: string; color: string }> = {
  idle: { icon: 'circle-outline', color: 'disabledForeground' },
  running: { icon: 'sync~spin', color: 'charts.yellow' },
  success: { icon: 'pass-filled', color: 'testing.iconPassed' },
  failed: { icon: 'error', color: 'testing.iconFailed' },
  cancelled: { icon: 'circle-slash', color: 'charts.orange' },
  invalid: { icon: 'warning', color: 'problemsWarningIcon.foreground' },
};

export function deriveDisplayStatus(status: CommandStatus, isInvalid: boolean): ExecutionStatus {
  if (isInvalid) {
    return 'invalid';
  }
  if (status.active.length > 0) {
    return 'running';
  }
  return status.lastResult?.status ?? 'idle';
}

export function formatStatusDescription(status: ExecutionStatus, commandStatus: CommandStatus, now: number): string {
  switch (status) {
    case 'running': {
      const start = commandStatus.active[0]?.startTime ?? now;
      const seconds = Math.max(0, Math.floor((now - start) / 1000));
      return commandStatus.active.length > 1 ? `Running ${seconds}s ×${commandStatus.active.length}` : `Running ${seconds}s`;
    }
    case 'success': {
      const durationMs = commandStatus.lastResult?.durationMs ?? 0;
      return `✓ ${(durationMs / 1000).toFixed(1)}s`;
    }
    case 'failed': {
      const exitCode = commandStatus.lastResult?.exitCode;
      return `✗ exit ${exitCode ?? '?'}`;
    }
    case 'cancelled':
      return 'Cancelled';
    case 'invalid':
      return 'Invalid config';
    case 'idle':
    default:
      return '';
  }
}

export function describeCommandLine(def: CommandDefinition): string {
  if (def.command) {
    return def.command;
  }
  if (def.file) {
    return [def.file, ...(def.args ?? [])].join(' ');
  }
  return '';
}

export interface CommandViewState {
  status: ExecutionStatus;
  description: string;
  tooltip: string;
  contextValue: string;
  iconId: string;
  iconColor: string;
}

export function buildCommandViewState(
  def: CommandDefinition,
  commandStatus: CommandStatus,
  isInvalid: boolean,
  now: number,
  isFavorite: boolean,
): CommandViewState {
  const status = deriveDisplayStatus(commandStatus, isInvalid);
  const { icon, color } = STATUS_ICONS[status];

  const tooltipLines = [describeCommandLine(def)];
  if (def.cwd) {
    tooltipLines.push(`cwd: ${def.cwd}`);
  }
  if (def.description) {
    tooltipLines.push(def.description);
  }

  return {
    status,
    description: formatStatusDescription(status, commandStatus, now),
    tooltip: tooltipLines.join('\n'),
    contextValue: `cmd.${status}.${isFavorite ? 'fav' : 'nofav'}`,
    iconId: icon,
    iconColor: color,
  };
}

export function filterGroups(groups: CommandGroup[], filterText: string): CommandGroup[] {
  const needle = filterText.trim().toLowerCase();
  if (!needle) {
    return groups;
  }

  return groups
    .map((group) => ({
      ...group,
      commands: group.commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(needle) || (cmd.description ?? '').toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.commands.length > 0);
}

export function buildCommandTree(
  groups: CommandGroup[],
  favoriteIds: string[],
  recentIds: string[],
  filterText: string,
): CommandGroup[] {
  const filtered = filterGroups(groups, filterText);

  const allCommands = new Map<string, CommandDefinition>();
  for (const group of groups) {
    for (const cmd of group.commands) {
      allCommands.set(cmd.id, cmd);
    }
  }

  const filteredIds = new Set<string>();
  for (const group of filtered) {
    for (const cmd of group.commands) {
      filteredIds.add(cmd.id);
    }
  }

  const resolveIds = (ids: string[]): CommandDefinition[] =>
    ids
      .filter((id) => filteredIds.has(id))
      .map((id) => allCommands.get(id))
      .filter((cmd): cmd is CommandDefinition => cmd !== undefined);

  const favoriteCommands = resolveIds(favoriteIds);
  const recentCommands = resolveIds(recentIds);

  const result: CommandGroup[] = [];
  if (favoriteCommands.length > 0) {
    result.push({ name: '⭐ Favorites', commands: favoriteCommands });
  }
  if (recentCommands.length > 0) {
    result.push({ name: '🕐 Recent', commands: recentCommands });
  }
  result.push(...filtered);
  return result;
}
