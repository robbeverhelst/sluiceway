// The command line's one way to the app (record 0116): HTTPS to the app's
// /api/v1, with the person's token, and to no other address. The app's
// answers are its own words, in the shapes of its OpenAPI document, version 1.

import { EXIT } from "./exit.ts";

// An answer that is not a success, in the app's words or the command line's,
// with the exit code it ends the command with.
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly exit: number,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

export interface AppClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

// The app's error codes and what an agent does about each.
const EXIT_OF: Record<string, number> = {
  "no-token": EXIT.signedOut,
  "token-not-working": EXIT.signedOut,
  "org-gone": EXIT.signedOut,
  "not-a-member": EXIT.signedOut,
  "not-found": EXIT.notFound,
  "rate-limited": EXIT.later,
  "github-silent": EXIT.later,
  "changes-refused": EXIT.refused,
};

const TIMEOUT_MS = 30_000;

export function appClient(options: {
  app: string;
  token: string;
  version: string;
  fetch: typeof fetch;
}): AppClient {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await options.fetch(`${options.app}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: "application/json",
          "user-agent": `sluiceway/${options.version}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AppError(`Could not reach ${options.app}: ${reason}`, "unreachable", EXIT.failed);
    }
    let answer: unknown;
    try {
      answer = await response.json();
    } catch {
      answer = undefined;
    }
    if (answer === null || typeof answer !== "object") {
      throw new AppError(
        `${options.app} answered ${response.status}, and not with the app's words.`,
        "not-the-app",
        EXIT.failed,
      );
    }
    if (response.ok) return answer as T;
    const { error, code, problems } = answer as {
      error?: unknown;
      code?: unknown;
      problems?: unknown;
    };
    if (typeof error !== "string" || typeof code !== "string") {
      throw new AppError(
        `${options.app} answered ${response.status}, and not with the app's words.`,
        "not-the-app",
        EXIT.failed,
      );
    }
    const retry = response.headers.get("retry-after");
    const message =
      code === "rate-limited" && retry !== null && /^\d+$/.test(retry)
        ? `${error} Try again in ${retry} seconds.`
        : error;
    throw new AppError(
      message,
      code,
      EXIT_OF[code] ?? EXIT.failed,
      Array.isArray(problems) ? problems.map(String) : [],
    );
  };
  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
  };
}
