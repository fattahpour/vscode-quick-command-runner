import { HistoryEntry } from './types';

export type HistorySort = 'time' | 'duration' | 'status';

export interface HistoryMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export interface HistoryManagerOptions {
  historyLimit: number;
  recentLimit: number;
}

const HISTORY_KEY = 'quickCommandRunner.history';

export function filterEntries(entries: HistoryEntry[], filterText: string): HistoryEntry[] {
  const needle = filterText.trim().toLowerCase();
  if (!needle) {
    return entries;
  }
  return entries.filter(
    (entry) =>
      entry.commandSnapshot.name.toLowerCase().includes(needle) ||
      entry.status.toLowerCase().includes(needle),
  );
}

export function sortEntries(entries: HistoryEntry[], sort: HistorySort): HistoryEntry[] {
  const copy = [...entries];
  switch (sort) {
    case 'duration':
      return copy.sort((a, b) => b.durationMs - a.durationMs);
    case 'status':
      return copy.sort((a, b) => {
        const statusCompare = a.status.localeCompare(b.status);
        return statusCompare !== 0 ? statusCompare : b.endTime - a.endTime;
      });
    case 'time':
    default:
      return copy.sort((a, b) => b.endTime - a.endTime);
  }
}

export class HistoryManager {
  private sort: HistorySort = 'time';
  private filterText = '';

  constructor(
    private readonly memento: HistoryMemento,
    private readonly options: HistoryManagerOptions,
  ) {}

  add(entry: HistoryEntry): void {
    const history = this.memento.get<HistoryEntry[]>(HISTORY_KEY, []);
    history.unshift(entry);
    while (history.length > this.options.historyLimit) {
      history.pop();
    }
    void this.memento.update(HISTORY_KEY, history);
  }

  getAll(): HistoryEntry[] {
    const history = this.memento.get<HistoryEntry[]>(HISTORY_KEY, []);
    return sortEntries(filterEntries(history, this.filterText), this.sort);
  }

  clear(): void {
    void this.memento.update(HISTORY_KEY, []);
  }

  setSort(sort: HistorySort): void {
    this.sort = sort;
  }

  getSort(): HistorySort {
    return this.sort;
  }

  setFilter(filterText: string): void {
    this.filterText = filterText;
  }

  getFilter(): string {
    return this.filterText;
  }
}
