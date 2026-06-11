import {
  CommandDefinition,
  ConfigLoadResult,
  ConfigValidationError,
  QuickCommandRunnerConfig,
  ShellType,
} from './types';

const VALID_SHELLS: ShellType[] = [
  'auto',
  'bash',
  'gitbash',
  'wsl',
  'cmd',
  'powershell',
  'pwsh',
  'sh',
  'zsh',
];

export function parseConfig(raw: string): QuickCommandRunnerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { groups: [] };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { groups?: unknown }).groups)
  ) {
    return { groups: [] };
  }
  return parsed as QuickCommandRunnerConfig;
}

export function validateConfig(config: QuickCommandRunnerConfig): ConfigLoadResult {
  const validCommands = new Map<string, CommandDefinition>();
  const invalidCommands = new Map<string, ConfigValidationError>();
  const errors: ConfigValidationError[] = [];
  const seenIds = new Set<string>();

  for (const group of config.groups ?? []) {
    for (const cmd of group.commands ?? []) {
      const hasCommand = typeof cmd.command === 'string' && cmd.command.length > 0;
      const hasFile = typeof cmd.file === 'string' && cmd.file.length > 0;

      if (hasCommand === hasFile) {
        const error: ConfigValidationError = {
          commandId: cmd.id,
          groupName: group.name,
          message: `Command "${cmd.id}" must set exactly one of "command" or "file" (found ${
            hasCommand ? 'both' : 'neither'
          }).`,
        };
        invalidCommands.set(`${group.name}/${cmd.id}`, error);
        errors.push(error);
        continue;
      }

      if (cmd.shell !== undefined && !VALID_SHELLS.includes(cmd.shell)) {
        const error: ConfigValidationError = {
          commandId: cmd.id,
          groupName: group.name,
          message: `Command "${cmd.id}" has unknown shell "${cmd.shell}".`,
        };
        invalidCommands.set(`${group.name}/${cmd.id}`, error);
        errors.push(error);
        continue;
      }

      if (seenIds.has(cmd.id)) {
        const error: ConfigValidationError = {
          commandId: cmd.id,
          groupName: group.name,
          message: `Duplicate command id "${cmd.id}".`,
        };
        invalidCommands.set(`${group.name}/${cmd.id}`, error);
        errors.push(error);
        continue;
      }

      seenIds.add(cmd.id);
      validCommands.set(cmd.id, cmd);
    }
  }

  return { config, validCommands, invalidCommands, errors };
}
