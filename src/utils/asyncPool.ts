export const REVIEWED_IMAGE_CONCURRENCY = 8;

export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.floor(concurrency)),
  );
  let nextIndex = 0;

  const runNext = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
}
