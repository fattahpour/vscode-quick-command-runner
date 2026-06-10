import * as vscode from 'vscode';

export class ClipboardManager {
  async copy(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }
}
