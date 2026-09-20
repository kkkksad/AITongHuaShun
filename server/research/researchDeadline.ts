export interface ResearchDeadlineOptions<T> {
  task: Promise<T> | T;
  timeoutMs: number;
  fallback: (reason: unknown) => T;
}

/**
 * Bounds optional research latency without turning an unavailable source into
 * a trading signal. The task remains observed so a late rejection is handled.
 */
export async function withResearchDeadline<T>(
  options: ResearchDeadlineOptions<T>,
): Promise<T> {
  const timeoutMs = Math.max(1, Math.round(options.timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(options.fallback(new Error('研究辅助源超时')));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(options.task),
      timeout,
    ]);
  } catch (error) {
    return options.fallback(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
