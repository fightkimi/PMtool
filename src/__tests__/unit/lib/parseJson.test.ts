import { describe, expect, it } from 'vitest';
import { extractJson } from '@/lib/parseJson';

describe('extractJson', () => {
  it('parses normal json directly', () => {
    expect(extractJson('{"type":"task","tasks":[]}')).toEqual({
      type: 'task',
      tasks: []
    });
  });

  it('extracts json when surrounded by extra text', () => {
    expect(extractJson('好的，分析结果如下：\n{"type":"task","tasks":[]}\n希望对你有帮助。')).toEqual({
      type: 'task',
      tasks: []
    });
  });

  it('extracts json from markdown code fences', () => {
    expect(extractJson('```json\n{"status":"done"}\n```')).toEqual({
      status: 'done'
    });
  });

  it('extracts nested json with bracket counting', () => {
    expect(
      extractJson('{"type":"task","tasks":[{"title":"A","acceptance_criteria":["1","2"]}]}')
    ).toEqual({
      type: 'task',
      tasks: [{ title: 'A', acceptance_criteria: ['1', '2'] }]
    });
  });

  it('removes think blocks only when stripThink is enabled', () => {
    expect(extractJson('<think>让我分析</think>\n{"type":"task","tasks":[]}', { stripThink: true })).toEqual({
      type: 'task',
      tasks: []
    });
  });

  it('can still extract json when think blocks are not stripped explicitly', () => {
    expect(extractJson('<think>内容</think>{"type":"task","tasks":[]}')).toEqual({
      type: 'task',
      tasks: []
    });
  });

  it('throws a helpful error when json cannot be extracted', () => {
    expect(() => extractJson('这是一段完全没有 JSON 的文本')).toThrow(
      /无法解析 AI 返回的 JSON。内容前200字：这是一段完全没有 JSON 的文本/
    );
  });
});
