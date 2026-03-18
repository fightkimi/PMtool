function extractFirstBracket(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (!char) {
      continue;
    }

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\' && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === open) {
      depth += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function extractJson(raw: string, options?: { stripThink?: boolean }): unknown {
  if (!raw || typeof raw !== 'string') {
    throw new Error('AI 返回内容为空');
  }

  let cleaned = raw;

  if (options?.stripThink) {
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>\n?/g, '').trim();
  }

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to bracket extraction.
  }

  const objectCandidate = extractFirstBracket(cleaned, '{', '}');
  if (objectCandidate !== null) {
    try {
      return JSON.parse(objectCandidate);
    } catch {
      // Continue to array extraction.
    }
  }

  const arrayCandidate = extractFirstBracket(cleaned, '[', ']');
  if (arrayCandidate !== null) {
    try {
      return JSON.parse(arrayCandidate);
    } catch {
      // Fall through to final error.
    }
  }

  throw new Error(`无法解析 AI 返回的 JSON。内容前200字：${cleaned.slice(0, 200)}`);
}

export function parseJson<T>(raw: string): T {
  return extractJson(raw) as T;
}
