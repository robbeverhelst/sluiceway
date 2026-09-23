// The most previews at once when the size comes from the cores (record 0085).
// A preview holds memory and calls the backend and the cloud as well as the
// CPU, and a machine can report more cores than its job may use, so more
// cores alone never make a larger pool than this. The input can.
export const MAX_POOL_FROM_CORES = 8;

// The size of the pool and where it came from, for the job log.
export type PoolSize =
  | { size: number; from: "input" }
  | { size: number; from: "cores"; cores: number }
  // The machine gave no count of its cores. The pool is 1, which never has
  // two previews share a core.
  | { size: 1; from: "unknown" };

// Previewing is bound by the CPU, so a pool larger than the cores does not
// finish a scan sooner: every preview takes longer, and nears its time limit
// for nothing (issue 198). The `concurrency` input wins when it is set.
// `cores` is what the machine reports, or undefined when it could not say.
export function poolSize(input: number | undefined, cores: number | undefined): PoolSize {
  if (input !== undefined) return { size: input, from: "input" };
  if (cores === undefined || !Number.isInteger(cores) || cores < 1) {
    return { size: 1, from: "unknown" };
  }
  return { size: Math.min(cores, MAX_POOL_FROM_CORES), from: "cores", cores };
}

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
