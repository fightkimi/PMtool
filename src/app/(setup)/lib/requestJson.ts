export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = `请求失败 (${response.status})`;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) {
        message = json.error;
      }
    } catch {
      // 非 JSON 响应，使用默认错误信息
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
