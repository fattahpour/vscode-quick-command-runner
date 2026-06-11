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
const FAVORITES_KEY = 'quickCommandRunner.favorites';
const RECENT_KEY = 'quickCommandRunner.recent';

export const HISTORY_OUTPUT_CAP = 100 * 1024;
export const TRUNCATION_MARKER = '\n…[truncated]';

export class TruncatingBuffer {
  private chunks: string[] = [];
  private length = 0;
  private truncated = false;

  constructor(private readonly cap: number = HISTORY_OUTPUT_CAP) {}

  append(text: string): void {
    if (this.truncated) {
      return;
    }
    this.chunks.push(text);
    this.length += text.length;
    if (this.length > this.cap) {
      this.truncated = true;
    }
  }

  toString(): string {
    const full = this.chunks.join('');
    return this.truncated ? full.slice(0, this.cap) + TRUNCATION_MARKER : full;
  }
}

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

  getFavorites(): string[] {
    return this.memento.get<string[]>(FAVORITES_KEY, []);
  }

  isFavorite(commandId: string): boolean {
    return this.getFavorites().includes(commandId);
  }

  toggleFavorite(commandId: string): void {
    const favorites = this.getFavorites();
    const index = favorites.indexOf(commandId);
    if (index >= 0) {
      favorites.splice(index, 1);
    } else {
      favorites.push(commandId);
    }
    void this.memento.update(FAVORITES_KEY, favorites);
  }

  getRecent(): string[] {
    return this.memento.get<string[]>(RECENT_KEY, []);
  }

  recordUsed(commandId: string): void {
    const recent = this.getRecent().filter((id) => id !== commandId);
    recent.unshift(commandId);
    while (recent.length > this.options.recentLimit) {
      recent.pop();
    }
    void this.memento.update(RECENT_KEY, recent);
  }
}
