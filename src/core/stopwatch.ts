// Where the time of a job went, part by part, on an injected clock (build
// plan, section 5). A part can be timed more than once, and its times add up.
// It measures and decides nothing (slice 5.23).

export interface Stopwatch<Part extends string> {
  // Runs the work and adds the time it took to the part, also when it throws.
  time<T>(part: Part, work: () => T): T;
  // Milliseconds since the stopwatch was made.
  total(): number;
  // Milliseconds per part that was timed.
  parts(): Partial<Record<Part, number>>;
}

export function stopwatch<Part extends string>(now: () => Date): Stopwatch<Part> {
  const started = now().getTime();
  const parts: Partial<Record<Part, number>> = {};
  const add = (part: Part, from: number) => {
    parts[part] = (parts[part] ?? 0) + (now().getTime() - from);
  };
  return {
    time(part, work) {
      const from = now().getTime();
      let result: ReturnType<typeof work>;
      try {
        result = work();
      } catch (error) {
        add(part, from);
        throw error;
      }
      if (result instanceof Promise) {
        return result.finally(() => add(part, from)) as ReturnType<typeof work>;
      }
      add(part, from);
      return result;
    },
    total: () => now().getTime() - started,
    parts: () => ({ ...parts }),
  };
}
