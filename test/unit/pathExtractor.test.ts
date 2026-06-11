import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathExtractor } from '../../src/pathExtractor';

test('scan returns no paths for output with no path-like labels', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('Building project...\n'), []);
});

test('scan extracts a simple unix path after "path:"', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: /usr/local/bin\n'), ['/usr/local/bin']);
});

test('scan extracts a path from a label using "=" with no spaces', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('outputPath=/tmp/build/output.txt\n'), ['/tmp/build/output.txt']);
});

test('scan extracts a quoted path', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('configPath: "/etc/app/config.json"\n'), ['/etc/app/config.json']);
});

test('scan ignores values that do not look like paths', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: myproject\n'), []);
});

test('scan extracts a relative path with ./ prefix', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: ./dist/output\n'), ['./dist/output']);
});

test('scan extracts a Windows-style path', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: C:\\Users\\test\\file.txt\n'), ['C:\\Users\\test\\file.txt']);
});

test('scan extracts a tilde-relative path', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: ~/projects/output\n'), ['~/projects/output']);
});

test('scan buffers a partial line until a newline arrives', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: /tmp/abc'), []);
  assert.deepEqual(extractor.scan('.log\n'), ['/tmp/abc.log']);
});

test('flush extracts a path from a final line with no trailing newline', () => {
  const extractor = new PathExtractor();
  assert.deepEqual(extractor.scan('path: /tmp/final.log'), []);
  assert.deepEqual(extractor.flush(), ['/tmp/final.log']);
});

test('getExtractedPaths accumulates paths across multiple scans', () => {
  const extractor = new PathExtractor();
  extractor.scan('srcPath: /a/b\n');
  extractor.scan('destPath: /c/d\n');
  assert.deepEqual(extractor.getExtractedPaths(), ['/a/b', '/c/d']);
});
