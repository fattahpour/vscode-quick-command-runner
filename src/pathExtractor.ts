const LABEL_VALUE_RE = /\b\w*path\w*\s*[:=]\s*("?)([^\s"]+)\1/gi;
const LOOKS_LIKE_PATH_RE = /^(?:[A-Za-z]:[\\/]|\/|~\/|\.{1,2}[\\/])/;

/** Incrementally scans process output for `*path*[:=]value` tokens that look like filesystem paths (spec §7). */
export class PathExtractor {
  private buffer = '';
  private readonly extractedPaths: string[] = [];

  /** Scans a chunk of output, buffering any trailing partial line for the next call. Returns paths newly found in this chunk. */
  scan(chunk: string): string[] {
    const combined = this.buffer + chunk;
    const lines = combined.split('\n');
    this.buffer = lines.pop() ?? '';

    const found: string[] = [];
    for (const line of lines) {
      found.push(...this.scanLine(line));
    }
    return found;
  }

  /** Scans any remaining buffered partial line (call on process exit). Returns paths newly found. */
  flush(): string[] {
    if (!this.buffer) {
      return [];
    }
    const found = this.scanLine(this.buffer);
    this.buffer = '';
    return found;
  }

  /** All paths found so far, in the order they were encountered. */
  getExtractedPaths(): string[] {
    return [...this.extractedPaths];
  }

  private scanLine(line: string): string[] {
    const found: string[] = [];
    LABEL_VALUE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LABEL_VALUE_RE.exec(line)) !== null) {
      const value = match[2];
      if (LOOKS_LIKE_PATH_RE.test(value)) {
        this.extractedPaths.push(value);
        found.push(value);
      }
    }
    return found;
  }
}
