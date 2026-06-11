import * as vscode from 'vscode';
import { CommandDefinition, CommandGroup, ConfigLoadResult } from './types';
import { StatusManager, StatusChangeSubscription } from './statusManager';
import { buildCommandViewState, filterGroups } from './commandViewModel';

export class GroupTreeItem extends vscode.TreeItem {
  constructor(public readonly group: CommandGroup) {
    super(group.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'group';
  }
}

export class CommandTreeItem extends vscode.TreeItem {
  constructor(public readonly def: CommandDefinition, isInvalid: boolean, statusManager: StatusManager) {
    super(def.name, vscode.TreeItemCollapsibleState.None);

    const status = statusManager.getStatus(def.id);
    const viewState = buildCommandViewState(def, status, isInvalid, Date.now());

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
    const { config, invalidCommands } = this.getConfig();
    const groups = filterGroups(config.groups, this.filterText);

    if (!element) {
      return groups.map((group) => new GroupTreeItem(group));
    }

    if (element instanceof GroupTreeItem) {
      return element.group.commands.map((def) => {
        const isInvalid = invalidCommands.has(`${element.group.name}/${def.id}`);
        return new CommandTreeItem(def, isInvalid, this.statusManager);
      });
    }

    return [];
  }

  dispose(): void {
    this.statusSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }
}
