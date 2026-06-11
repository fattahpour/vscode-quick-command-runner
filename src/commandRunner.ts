import * as crypto from 'crypto';
import * as fs from 'fs';
import { CommandDefinition, ExecutionStatus, HistoryEntry } from './types';
import { buildSpawnArgs, cancelProcess, spawnProcess, ShellResolutionContext } from './processManager';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';
import { ClipboardManager } from './clipboardManager';
import { PathExtractor } from './pathExtractor';
import { HistoryManager, TruncatingBuffer } from './historyManager';

export interface CommandRunnerOptions {
  workspaceFolder: string;
  cancelGracePeriodMs: number;
  autoCopyPathDefault: boolean;
  notifyPathCopied: (path: string) => void;
}

export class CommandRunner {
  private readonly cancelledPids = new Set<number>();

  constructor(
    private readonly statusManager: StatusManager,
    private readonly logManager: LogManager,
    private readonly clipboardManager: ClipboardManager,
    private readonly historyManager: HistoryManager,
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
        extractedPaths: [],
      });
      return;
    }

    this.historyManager.recordUsed(resolved.id);

    const fullCommand = [spawnArgs.executable, ...spawnArgs.args].join(' ');
    const cwd = resolved.cwd ?? this.options.workspaceFolder;
    const env = { ...process.env, ...resolved.env };
    const startTime = Date.now();

    const { pid, child } = spawnProcess(spawnArgs.executable, spawnArgs.args, { cwd, env });
    this.statusManager.startExecution(resolved.id, pid, startTime);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = resolved.timeout;
    if (timeoutMs) {
      timeoutHandle = setTimeout(() => {
        this.logManager.appendTimeout(resolved.id, resolved.name, timeoutMs);
        void cancelProcess(pid, this.options.cancelGracePeriodMs);
      }, timeoutMs);
    }

    const pathExtractor = new PathExtractor();
    const stdoutBuffer = new TruncatingBuffer();
    const stderrBuffer = new TruncatingBuffer();
    let revealedLog = false;
    let copiedFirstPath = false;

    const handleChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = chunk.toString();
      this.logManager.appendOutput(resolved.id, resolved.name, stream, text);
      (stream === 'stdout' ? stdoutBuffer : stderrBuffer).append(text);

      if (resolved.autoOpenLog && !revealedLog) {
        revealedLog = true;
        this.logManager.show(resolved.id, resolved.name);
      }

      const newPaths = pathExtractor.scan(text);
      if (!copiedFirstPath && newPaths.length > 0) {
        copiedFirstPath = true;
        void this.copyFirstPath(resolved, newPaths[0]);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => handleChunk('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => handleChunk('stderr', chunk));

    await new Promise<void>((resolve) => {
      child.on('exit', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.logManager.flush(resolved.id, resolved.name);

        const flushedPaths = pathExtractor.flush();
        if (!copiedFirstPath && flushedPaths.length > 0) {
          copiedFirstPath = true;
          void this.copyFirstPath(resolved, flushedPaths[0]);
        }

        const wasCancelled = this.cancelledPids.delete(pid);
        const status: ExecutionStatus = wasCancelled ? 'cancelled' : code === 0 ? 'success' : 'failed';
        const endTime = Date.now();

        this.statusManager.finishExecution(resolved.id, pid, {
          status,
          endTime,
          durationMs: endTime - startTime,
          exitCode: code,
          extractedPaths: pathExtractor.getExtractedPaths(),
        });

        const historyEntry: HistoryEntry = {
          entryId: crypto.randomUUID(),
          commandId: resolved.id,
          commandSnapshot: resolved,
          fullCommand,
          shell: resolved.shell ?? 'auto',
          cwd,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          exitCode: code,
          status,
          stdout: stdoutBuffer.toString(),
          stderr: stderrBuffer.toString(),
          extractedPaths: pathExtractor.getExtractedPaths(),
        };
        this.historyManager.add(historyEntry);

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

  private async copyFirstPath(resolved: CommandDefinition, extractedPath: string): Promise<void> {
    const shouldCopy = resolved.autoCopyPath ?? this.options.autoCopyPathDefault;
    if (!shouldCopy) {
      return;
    }
    await this.clipboardManager.copy(extractedPath);
    this.logManager.appendInfo(resolved.id, resolved.name, `Copied path to clipboard: ${extractedPath}`);
    this.options.notifyPathCopied(extractedPath);
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
