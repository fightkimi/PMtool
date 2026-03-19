import { readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ALLOWED_SCRIPT_FILES = new Set([
  'scripts/debug/showJobs.ts',
  'scripts/debug/simWecom.ts',
  'scripts/debug/testTencentDoc.ts',
  'scripts/seed/index.ts',
  'scripts/seed/pipelines/ui_a.json',
  'scripts/seed/pipelines/ui_b.json',
  'scripts/seed/pipelines/ui_s.json'
]);
const TEST_FILE_PATTERN = /\.(test|spec)\.ts$/;
const TEMP_FILE_PATTERN = /\.(temp|bak|old)\.ts$/;
const IGNORE_DIRS = new Set(['.git', '.next', 'node_modules', 'coverage', 'dist', 'build']);

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(posix.normalize(relative(ROOT, fullPath).split('\\').join('/')));
    }
  }

  return files.sort();
}

function collectScriptFiles(): string[] {
  try {
    return walk(join(ROOT, 'scripts'));
  } catch {
    return [];
  }
}

function collectRepositoryFiles(): string[] {
  return walk(ROOT);
}

describe('project structure guard', () => {
  it('keeps all test files under src/__tests__', () => {
    const testFiles = collectRepositoryFiles().filter((file) => TEST_FILE_PATTERN.test(file));
    const illegalTests = testFiles.filter((file) => !file.startsWith('src/__tests__/'));

    expect(illegalTests).toEqual([]);
  });

  it('keeps only approved files under scripts/', () => {
    const scriptFiles = collectScriptFiles();
    const illegalScripts = scriptFiles.filter((file) => !ALLOWED_SCRIPT_FILES.has(file));

    expect(illegalScripts).toEqual([]);
  });

  it('does not keep temp or backup TypeScript files', () => {
    const illegalTempFiles = collectRepositoryFiles().filter((file) => TEMP_FILE_PATTERN.test(file));

    expect(illegalTempFiles).toEqual([]);
  });

  it('does not keep duplicate test files for the same module stem', () => {
    const testFiles = collectRepositoryFiles().filter((file) => TEST_FILE_PATTERN.test(file) && file.startsWith('src/__tests__/'));
    const stemMap = new Map<string, string[]>();

    for (const file of testFiles) {
      const stem = file.replace(/\/[^/]+$/, '').replace(/^src\/__tests__\//, '') + '::' + file.replace(/^.*\//, '').replace(/\.(test|spec)\.ts$/, '');
      stemMap.set(stem, [...(stemMap.get(stem) ?? []), file]);
    }

    const duplicates = [...stemMap.values()].filter((files) => files.length > 1);
    expect(duplicates).toEqual([]);
  });

  it('keeps src/__tests__ in expected top-level buckets only', () => {
    const testsRoot = join(ROOT, 'src', '__tests__');
    const entries = readdirSync(testsRoot, { withFileTypes: true });
    const topLevelDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

    expect(topLevelDirs).toEqual(['e2e', 'integration', 'unit']);
  });

  it('does not keep stray TypeScript files directly under scripts/', () => {
    const scriptRoot = join(ROOT, 'scripts');
    const entries = readdirSync(scriptRoot, { withFileTypes: true });
    const strayFiles = entries
      .filter((entry) => entry.isFile() && statSync(join(scriptRoot, entry.name)).isFile())
      .map((entry) => `scripts/${entry.name}`);

    expect(strayFiles).toEqual([]);
  });
});
