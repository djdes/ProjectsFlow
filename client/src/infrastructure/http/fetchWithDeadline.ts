/** Includes response-body consumption: fetch alone settles as soon as headers arrive. */
export async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Сервер не ответил вовремя. Проверьте соединение и повторите попытку.', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
