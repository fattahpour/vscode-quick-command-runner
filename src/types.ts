export type ShellType =
  | 'auto'
  | 'bash'
  | 'gitbash'
  | 'wsl'
  | 'cmd'
  | 'powershell'
  | 'pwsh'
  | 'sh'
  | 'zsh';

export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'invalid';

export interface CommandDefinition {
  id: string;
  name: string;
  description?: string;
  shell?: ShellType;
  command?: string;
  file?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  autoCopyPath?: boolean;
  autoOpenLog?: boolean;
  allowParallelExecution?: boolean;
}

export interface CommandGroup {
  name: string;
  commands: CommandDefinition[];
}

export interface QuickCommandRunnerConfig {
  groups: CommandGroup[];
}

export interface ConfigValidationError {
  commandId?: string;
  groupName?: string;
  message: string;
}

export interface ConfigLoadResult {
  config: QuickCommandRunnerConfig;
  validCommands: Map<string, CommandDefinition>;
  invalidCommands: Map<string, ConfigValidationError>;
  errors: ConfigValidationError[];
}

export interface HistoryEntry {
  entryId: string;
  commandId: string;
  commandSnapshot: CommandDefinition;
  fullCommand: string;
  shell: ShellType;
  cwd: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  exitCode: number | null;
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  extractedPaths: string[];
}

export interface ResolvedShell {
  executable: string;
  shellArgs: string[];
}

export interface ActiveExecution {
  pid: number;
  startTime: number;
}

export interface LastResult {
  status: ExecutionStatus;
  endTime: number;
  durationMs: number;
}

export interface CommandStatus {
  active: ActiveExecution[];
  lastResult: LastResult | null;
}
