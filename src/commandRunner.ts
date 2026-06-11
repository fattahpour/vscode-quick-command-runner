import * as fs from 'fs';
import { CommandDefinition, ExecutionStatus } from './types';
import { buildSpawnArgs, cancelProcess, spawnProcess, ShellResolutionContext } from './processManager';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';

export interface CommandRunnerOptions {
  workspaceFolder: string;
  cancelGracePeriodMs: number;
}

export class CommandRunner {
  private readonly cancelledPids = new Set<number>();

  constructor(
    private readonly statusManager: StatusManager,
    private readonly logManager: LogManager,
    private readonly options: CommandRunnerOptions,
  ) {}

  async run(def: CommandDefinition): Promise<void> {
    const existingStatus = this.statusManager.getStatus(def.id);
    if (existingStatus.active.length > 0 && !def.allowParallelExecution) {
      return;
    }

    const resolved = this.resolveDefinition(def);

    const ctx: ShellResolutionContext = {
      platform: process.platform,
      env: process.env,
      fileExists: fs.existsSync,
    };

    const spawnArgs = buildSpawnArgs(resolved, ctx);
    if (!spawnArgs) {
      this.logManager.appendConfigMessage(
        `Command "${resolved.name}" (${resolved.id}) cannot run: unsupported shell "${resolved.shell ?? 'auto'}" on this platform.`,
      );
      this.statusManager.finishExecution(resolved.id, -1, {
        status: 'invalid',
        endTime: Date.now(),
        durationMs: 0,
        exitCode: null,
      });
      return;
    }

    const cwd = resolved.cwd ?? this.options.workspaceFolder;
    const env = { ...process.env, ...resolved.env };
    const startTime = Date.now();

    const { pid, child } = spawnProcess(spawnArgs.executable, spawnArgs.args, { cwd, env });
    this.statusManager.startExecution(resolved.id, pid, startTime);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (resolved.timeout) {
      timeoutHandle = setTimeout(() => {
        void cancelProcess(pid, this.options.cancelGracePeriodMs);
      }, resolved.timeout);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logManager.appendOutput(resolved.id, resolved.name, 'stdout', chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.logManager.appendOutput(resolved.id, resolved.name, 'stderr', chunk.toString());
    });

    await new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.logManager.flush(resolved.id, resolved.name);

        const wasCancelled = this.cancelledPids.delete(pid);
        const status: ExecutionStatus = wasCancelled ? 'cancelled' : code === 0 ? 'success' : 'failed';
        const endTime = Date.now();

        this.statusManager.finishExecution(resolved.id, pid, {
          status,
          endTime,
          durationMs: endTime - startTime,
          exitCode: code,
        });
        resolve();
      });
    });
  }

  cancel(commandId: string): void {
    const status = this.statusManager.getStatus(commandId);
    for (const execution of status.active) {
      this.cancelledPids.add(execution.pid);
      void cancelProcess(execution.pid, this.options.cancelGracePeriodMs);
    }
  }

  /** Substitutes `${workspaceFolder}` across cwd/command/file/args/env (spec §3.2 step 2) and merges env over process.env. */
  private resolveDefinition(def: CommandDefinition): CommandDefinition {
    const substitute = (value: string): string =>
      value.replace(/\$\{workspaceFolder\}/g, this.options.workspaceFolder);

    return {
      ...def,
      cwd: def.cwd ? substitute(def.cwd) : def.cwd,
      command: def.command ? substitute(def.command) : def.command,
      file: def.file ? substitute(def.file) : def.file,
      args: def.args?.map(substitute),
      env: def.env
        ? Object.fromEntries(Object.entries(def.env).map(([key, value]) => [key, substitute(value)]))
        : def.env,
    };
  }
}
