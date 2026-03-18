import { extractJson, parseJson } from '@/lib/parseJson';

export function extractJsonText(input: string): string {
  const parsed = extractJson(input);
  return JSON.stringify(parsed);
}

export function parseJsonContent<T>(input: string): T {
  return parseJson<T>(input);
}
