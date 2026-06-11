import * as vscode from 'vscode';
import { HistoryEntry } from './types';
import { HistoryManager } from './historyManager';
import { buildHistoryViewState } from './historyViewModel';

export class HistoryTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: HistoryEntry) {
    super('', vscode.TreeItemCollapsibleState.None);

    const viewState = buildHistoryViewState(entry, Date.now());
    this.label = viewState.label;
    this.description = viewState.description;
    this.tooltip = viewState.tooltip;
    this.contextValue = viewState.contextValue;
    this.iconPath = new vscode.ThemeIcon(viewState.iconId, new vscode.ThemeColor(viewState.iconColor));
  }
}

export class HistoryProvider implements vscode.TreeDataProvider<HistoryTreeItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<HistoryTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly historyManager: HistoryManager) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryTreeItem): HistoryTreeItem[] {
    if (element) {
      return [];
    }
    return this.historyManager.getAll().map((entry) => new HistoryTreeItem(entry));
  }

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
