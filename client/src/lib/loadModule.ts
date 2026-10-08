/** Bound Suspense even when a module request never settles after a network switch. */
export async function loadModule<T>(loader: () => Promise<T>, timeoutMs = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loader(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Не удалось загрузить страницу. Проверьте соединение.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
