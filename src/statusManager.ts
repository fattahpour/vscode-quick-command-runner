import { CommandStatus, LastResult } from './types';

export type StatusChangeListener = (commandId: string) => void;

export interface StatusChangeSubscription {
  dispose(): void;
}

export class StatusManager {
  private readonly statuses = new Map<string, CommandStatus>();
  private listeners: StatusChangeListener[] = [];

  getStatus(commandId: string): CommandStatus {
    return this.statuses.get(commandId) ?? { active: [], lastResult: null };
  }

  onDidChangeStatus(listener: StatusChangeListener): StatusChangeSubscription {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((registered) => registered !== listener);
      },
    };
  }

  startExecution(commandId: string, pid: number, startTime: number): void {
    const status = this.getStatus(commandId);
    this.statuses.set(commandId, {
      active: [...status.active, { pid, startTime }],
      lastResult: status.lastResult,
    });
    this.notify(commandId);
  }

  finishExecution(commandId: string, pid: number, result: LastResult): void {
    const status = this.getStatus(commandId);
    this.statuses.set(commandId, {
      active: status.active.filter((execution) => execution.pid !== pid),
      lastResult: result,
    });
    this.notify(commandId);
  }

  private notify(commandId: string): void {
    for (const listener of this.listeners) {
      listener(commandId);
    }
  }
}
