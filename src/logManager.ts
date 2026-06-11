import * as vscode from 'vscode';

type OutputStream = 'stdout' | 'stderr';
type LogLineKind = OutputStream | 'info' | 'timeout';

function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => value.toString().padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export class LogManager {
  private readonly channels = new Map<string, vscode.OutputChannel>();
  private readonly buffers = new Map<string, string>();
  private configChannel: vscode.OutputChannel | undefined;

  appendOutput(commandId: string, commandName: string, stream: OutputStream, chunk: string): void {
    const channel = this.getChannel(commandId, commandName);
    const bufferKey = `${commandId}:${stream}`;
    const combined = (this.buffers.get(bufferKey) ?? '') + chunk;
    const lines = combined.split('\n');
    const remainder = lines.pop() ?? '';
    this.buffers.set(bufferKey, remainder);

    for (const line of lines) {
      this.writeLine(channel, stream, line);
    }
  }

  appendInfo(commandId: string, commandName: string, message: string): void {
    const channel = this.getChannel(commandId, commandName);
    this.writeLine(channel, 'info', message);
  }

  appendTimeout(commandId: string, commandName: string, timeoutMs: number): void {
    const channel = this.getChannel(commandId, commandName);
    this.writeLine(channel, 'timeout', `Command exceeded ${timeoutMs}ms and was terminated.`);
  }

  flush(commandId: string, commandName: string): void {
    const channel = this.getChannel(commandId, commandName);
    for (const stream of ['stdout', 'stderr'] as const) {
      const bufferKey = `${commandId}:${stream}`;
      const remainder = this.buffers.get(bufferKey);
      if (remainder) {
        this.writeLine(channel, stream, remainder);
        this.buffers.set(bufferKey, '');
      }
    }
  }

  show(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).show(true);
  }

  clear(commandId: string, commandName: string): void {
    this.getChannel(commandId, commandName).clear();
  }

  appendConfigMessage(message: string): void {
    if (!this.configChannel) {
      this.configChannel = vscode.window.createOutputChannel('Quick Command Runner: Configuration');
    }
    this.configChannel.appendLine(`[${formatTimestamp(new Date())}] ${message}`);
  }

  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.configChannel?.dispose();
  }

  private getChannel(commandId: string, commandName: string): vscode.OutputChannel {
    let channel = this.channels.get(commandId);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`Quick Command Runner: ${commandName}`);
      this.channels.set(commandId, channel);
    }
    return channel;
  }

  private writeLine(channel: vscode.OutputChannel, kind: LogLineKind, line: string): void {
    const tag = kind === 'stderr' ? ' [stderr]' : kind === 'info' ? ' [info]' : kind === 'timeout' ? ' [timeout]' : '';
    channel.appendLine(`[${formatTimestamp(new Date())}]${tag} ${line}`);
  }
}
