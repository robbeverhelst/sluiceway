// The bounded pool a scan previews through (record 0012). It starts the items
// in the order given, never more than `size` at once, and starts the next one
// the moment one finishes. Every item is handed to the worker exactly once, so
// a stack is never previewed twice at the same time. The results come back in
// the order of the items, whatever finished first.
//
// A worker that throws fails the pool: nothing new is started and the error
// is the pool's. A preview never throws for a broken stack (the adapter turns
// that into a preview failure), so a throw here is a fault of Sluiceway's own.
export async function runPool<Item, Result>(
  items: readonly Item[],
  size: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("The size of the pool must be a whole number of 1 or more.");
  }
  const results = new Array<Result>(items.length);
  let next = 0;
  let failed = false;
  const slot = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await work(items[index] as Item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, slot));
  return results;
}
