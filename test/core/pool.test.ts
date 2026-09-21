import { describe, expect, test } from "bun:test";
import { runPool } from "../../src/core/pool.ts";

// A worker whose every call waits until the test lets it go, so the test sees
// exactly what the pool has started at any moment.
function gate<T>() {
  const started: T[] = [];
  const waiting = new Map<T, () => void>();
  const work = (item: T) =>
    new Promise<T>((resolve) => {
      started.push(item);
      waiting.set(item, () => resolve(item));
    });
  const finish = async (item: T) => {
    waiting.get(item)?.();
    // Lets the pool react before the test looks again.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { started, work, finish };
}

describe("the pool (record 0012)", () => {
  test("starts no more than its size at once, in the order given", async () => {
    const { started, work, finish } = gate<string>();
    const done = runPool(["a", "b", "c", "d", "e"], 2, work);
    await finish("none");
    expect(started).toEqual(["a", "b"]);
    await finish("b");
    expect(started).toEqual(["a", "b", "c"]);
    await finish("c");
    expect(started).toEqual(["a", "b", "c", "d"]);
    await finish("a");
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    await finish("d");
    await finish("e");
    expect(await done).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("gives the results in the order of the items, whatever finished first", async () => {
    const { work, finish } = gate<number>();
    const done = runPool([1, 2, 3], 3, work);
    await finish(3);
    await finish(1);
    await finish(2);
    expect(await done).toEqual([1, 2, 3]);
  });

  test("a pool larger than the list starts everything and nothing more", async () => {
    const { started, work, finish } = gate<string>();
    const done = runPool(["a", "b"], 8, work);
    await finish("none");
    expect(started).toEqual(["a", "b"]);
    await finish("a");
    await finish("b");
    expect(await done).toEqual(["a", "b"]);
  });

  test("an empty list is done at once", async () => {
    expect(await runPool([], 4, async (item: string) => item)).toEqual([]);
  });

  test("never runs the same item twice", async () => {
    const seen: string[] = [];
    await runPool(["a", "b", "c", "d"], 3, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("a worker that throws fails the pool, and nothing new is started", async () => {
    const { started, work, finish } = gate<string>();
    const done = runPool(["a", "b", "c"], 1, (item) =>
      item === "a" ? Promise.reject(new Error("broken")) : work(item),
    );
    await expect(done).rejects.toThrow("broken");
    await finish("none");
    expect(started).toEqual([]);
  });

  test.each([0, -1, 1.5, Number.NaN])("refuses a size of %p", async (size) => {
    await expect(runPool(["a"], size, async (item) => item)).rejects.toThrow(
      "The size of the pool must be a whole number of 1 or more.",
    );
  });
});
