import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CommandDefinition, ConfigLoadResult } from './types';
import { configFilePath, loadConfigFromFile } from './configLoader';
import { DEFAULT_CONFIG } from './defaultConfig';
import { StatusManager } from './statusManager';
import { LogManager } from './logManager';
import { ClipboardManager } from './clipboardManager';
import { HistoryManager, HistorySort } from './historyManager';
import { CommandRunner } from './commandRunner';
import { CommandProvider, CommandTreeItem } from './commandProvider';
import { HistoryProvider, HistoryTreeItem } from './historyProvider';
import { describeCommandLine } from './commandViewModel';

const EMPTY_CONFIG: ConfigLoadResult = {
  config: { groups: [] },
  validCommands: new Map(),
  invalidCommands: new Map(),
  errors: [],
};

const SORT_OPTIONS: { label: string; value: HistorySort }[] = [
  { label: 'Time', value: 'time' },
  { label: 'Duration', value: 'duration' },
  { label: 'Status', value: 'status' },
];

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceFolder = folder?.uri.fsPath;

  const statusManager = new StatusManager();
  const logManager = new LogManager();
  const clipboardManager = new ClipboardManager();

  const historyLimitSetting = (): number =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<number>('historyLimit', 200);

  const recentLimitSetting = (): number =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<number>('recentLimit', 5);

  const historyManager = new HistoryManager(context.workspaceState, {
    historyLimit: historyLimitSetting(),
    recentLimit: recentLimitSetting(),
  });

  let configResult: ConfigLoadResult = EMPTY_CONFIG;

  const reloadConfig = (): void => {
    if (!workspaceFolder) {
      configResult = EMPTY_CONFIG;
      void vscode.commands.executeCommand('setContext', 'quickCommandRunner.configExists', false);
      return;
    }

    const filePath = configFilePath(workspaceFolder);
    const result = loadConfigFromFile(filePath, fs);
    configResult = result ?? EMPTY_CONFIG;

    for (const error of configResult.errors) {
      logManager.appendConfigMessage(error.message);
    }

    void vscode.commands.executeCommand('setContext', 'quickCommandRunner.configExists', result !== null);
  };

  reloadConfig();

  const provider = new CommandProvider(() => configResult, statusManager, historyManager);
  const treeView = vscode.window.createTreeView('quickCommandRunnerCommands', {
    treeDataProvider: provider,
  });

  const historyProvider = new HistoryProvider(historyManager);
  const historyTreeView = vscode.window.createTreeView('quickCommandRunnerHistory', {
    treeDataProvider: historyProvider,
  });

  const cancelGracePeriodMs = vscode.workspace
    .getConfiguration('quickCommandRunner')
    .get<number>('cancelGracePeriodMs', 3000);

  const showNotificationsEnabled = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('showNotifications', true);

  const autoCopyPathDefault = (): boolean =>
    vscode.workspace.getConfiguration('quickCommandRunner').get<boolean>('autoCopyPath', true);

  const runner = workspaceFolder
    ? new CommandRunner(statusManager, logManager, clipboardManager, historyManager, {
        workspaceFolder,
        cancelGracePeriodMs,
        autoCopyPathDefault: autoCopyPathDefault(),
        notifyPathCopied: (copiedPath: string) => {
          if (showNotificationsEnabled()) {
            void vscode.window.showInformationMessage(`Path copied to clipboard: ${copiedPath}`);
          }
        },
      })
    : undefined;

  const runCommand = async (def: CommandDefinition): Promise<void> => {
    if (!runner) {
      void vscode.window.showErrorMessage('Quick Command Runner: no workspace folder is open.');
      return;
    }

    if (!showNotificationsEnabled()) {
      await runner.run(def);
      historyProvider.refresh();
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Running "${def.name}"`, cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => runner.cancel(def.id));
        await runner.run(def);
      },
    );

    historyProvider.refresh();

    const lastResult = statusManager.getStatus(def.id).lastResult;
    if (lastResult?.status === 'success') {
      void vscode.window.showInformationMessage(`"${def.name}" completed successfully.`);
    } else if (lastResult?.status === 'failed') {
      void vscode.window.showErrorMessage(`"${def.name}" failed (exit ${lastResult.exitCode ?? '?'}).`);
    } else if (lastResult?.status === 'cancelled') {
      void vscode.window.showWarningMessage(`"${def.name}" was cancelled.`);
    }
  };

  context.subscriptions.push(
    treeView,
    historyTreeView,
    provider,
    historyProvider,
    logManager,

    vscode.commands.registerCommand('quickCommandRunner.run', async (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      const def = configResult.validCommands.get(item.def.id);
      if (!def) {
        return;
      }
      await runCommand(def);
    }),

    vscode.commands.registerCommand('quickCommandRunner.cancel', (item?: CommandTreeItem) => {
      if (!item || !runner) {
        return;
      }
      runner.cancel(item.def.id);
    }),

    vscode.commands.registerCommand('quickCommandRunner.refresh', () => {
      reloadConfig();
      provider.refresh();
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.search', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter commands by name or description',
        value: provider.getFilter(),
      });
      if (value === undefined) {
        return;
      }
      provider.setFilter(value);
      void vscode.commands.executeCommand('setContext', 'quickCommandRunner.filterActive', value.length > 0);
    }),

    vscode.commands.registerCommand('quickCommandRunner.clearFilter', () => {
      provider.clearFilter();
      void vscode.commands.executeCommand('setContext', 'quickCommandRunner.filterActive', false);
    }),

    vscode.commands.registerCommand('quickCommandRunner.openLog', (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      logManager.show(item.def.id, item.def.name);
    }),

    vscode.commands.registerCommand('quickCommandRunner.clearLog', (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      logManager.clear(item.def.id, item.def.name);
    }),

    vscode.commands.registerCommand('quickCommandRunner.copyCommandLine', async (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      await clipboardManager.copy(describeCommandLine(item.def));
      if (showNotificationsEnabled()) {
        void vscode.window.showInformationMessage('Command line copied to clipboard.');
      }
    }),

    vscode.commands.registerCommand('quickCommandRunner.createConfig', () => {
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Quick Command Runner: no workspace folder is open.');
        return;
      }

      const filePath = configFilePath(workspaceFolder);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n', 'utf8');

      reloadConfig();
      provider.refresh();
      void vscode.window.showInformationMessage('Created .vscode/quick-command-runner.json');
    }),

    vscode.commands.registerCommand('quickCommandRunner.toggleFavorite', (item?: CommandTreeItem) => {
      if (!item) {
        return;
      }
      historyManager.toggleFavorite(item.def.id);
      provider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historySort', async () => {
      const picked = await vscode.window.showQuickPick(
        SORT_OPTIONS.map((option) => option.label),
        { placeHolder: 'Sort history by' },
      );
      if (!picked) {
        return;
      }
      const option = SORT_OPTIONS.find((candidate) => candidate.label === picked);
      if (!option) {
        return;
      }
      historyManager.setSort(option.value);
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyFilter', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter history by command name or status',
        value: historyManager.getFilter(),
      });
      if (value === undefined) {
        return;
      }
      historyManager.setFilter(value);
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyClear', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Clear all command history? This cannot be undone.',
        { modal: true },
        'Clear History',
      );
      if (choice !== 'Clear History') {
        return;
      }
      historyManager.clear();
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyRerun', async (item?: HistoryTreeItem) => {
      if (!item) {
        return;
      }
      await runCommand(item.entry.commandSnapshot);
    }),

    vscode.commands.registerCommand('quickCommandRunner.historyOpenLog', async (item?: HistoryTreeItem) => {
      if (!item) {
        return;
      }
      const { entry } = item;
      if (logManager.hasChannel(entry.commandId)) {
        logManager.show(entry.commandId, entry.commandSnapshot.name);
        return;
      }
      const content = [
        `$ ${entry.fullCommand}`,
        '',
        '--- stdout ---',
        entry.stdout,
        '--- stderr ---',
        entry.stderr,
      ].join('\n');
      const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
  );

  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.vscode/quick-command-runner.json'),
    );
    const onChange = (): void => {
      reloadConfig();
      provider.refresh();
    };
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    context.subscriptions.push(watcher);
  }
}

export function deactivate(): void {}
