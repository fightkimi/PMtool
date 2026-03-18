import type { AIAdapter, AIMessage, AIOptions } from '@/adapters/types';
import { extractJson } from '@/lib/parseJson';

export async function callAIWithRetry(
  ai: AIAdapter,
  messages: AIMessage[],
  options: AIOptions,
  maxRetries = 2
): Promise<unknown> {
  let attemptMessages = [...messages];

  for (let index = 0; index < maxRetries; index += 1) {
    const response = await ai.chat(attemptMessages, options);

    try {
      return extractJson(response.content);
    } catch (error) {
      if (index === maxRetries - 1) {
        console.error('[AIUtils] JSON 解析彻底失败，原始内容：', response.content.slice(0, 300));
        throw error;
      }

      console.log(`[AIUtils] 第 ${index + 1} 次解析失败，发起重试`);
      attemptMessages = [
        ...attemptMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: '你的输出不是合法 JSON。请只输出 JSON 对象，不要任何其他内容。' }
      ];
    }
  }

  throw new Error('callAIWithRetry: 不应该走到这里');
}
