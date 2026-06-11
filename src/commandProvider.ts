import * as vscode from 'vscode';
import { CommandDefinition, CommandGroup, ConfigLoadResult } from './types';
import { StatusManager, StatusChangeSubscription } from './statusManager';
import { HistoryManager } from './historyManager';
import { buildCommandViewState, buildCommandTree } from './commandViewModel';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: CommandGroup) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
  }
}

export class CommandTreeItem extends vscode.TreeItem {
  constructor(
    public readonly def: CommandDefinition,
    isInvalid: boolean,
    statusManager: StatusManager,
    isFavorite: boolean,
  ) {
    super(def.name, vscode.TreeItemCollapsibleState.None);

    const status = statusManager.getStatus(def.id);
    const viewState = buildCommandViewState(def, status, isInvalid, Date.now(), isFavorite);

    this.description = viewState.description;
    this.tooltip = viewState.tooltip;
    this.contextValue = viewState.contextValue;
    this.iconPath = new vscode.ThemeIcon(viewState.iconId, new vscode.ThemeColor(viewState.iconColor));
  }
}

export type CommandNode = GroupTreeItem | CommandTreeItem;

export class CommandProvider implements vscode.TreeDataProvider<CommandNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CommandNode | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private filterText = '';
  private readonly statusSubscription: StatusChangeSubscription;

  constructor(
    private readonly getConfig: () => ConfigLoadResult,
    private readonly statusManager: StatusManager,
    private readonly historyManager: HistoryManager,
  ) {
    this.statusSubscription = statusManager.onDidChangeStatus(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getFilter(): string {
    return this.filterText;
  }

  setFilter(text: string): void {
    this.filterText = text;
    this.refresh();
  }

  clearFilter(): void {
    this.filterText = '';
    this.refresh();
  }

  getTreeItem(element: CommandNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandNode): CommandNode[] {
    const { config, validCommands, invalidCommands } = this.getConfig();
    const tree = buildCommandTree(
      config.groups,
      this.historyManager.getFavorites(),
      this.historyManager.getRecent(),
      this.filterText,
    );

    if (!element) {
      return tree.map((group) => new GroupTreeItem(group));
    }

    if (element instanceof GroupTreeItem) {
      const isSyntheticGroup = element.group.name === '⭐ Favorites' || element.group.name === '🕐 Recent';
      return element.group.commands.map((def) => {
        const isInvalid = isSyntheticGroup
          ? !validCommands.has(def.id)
          : invalidCommands.has(`${element.group.name}/${def.id}`);
        const isFavorite = this.historyManager.isFavorite(def.id);
        return new CommandTreeItem(def, isInvalid, this.statusManager, isFavorite);
      });
    }

    return [];
  }

  dispose(): void {
    this.statusSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
