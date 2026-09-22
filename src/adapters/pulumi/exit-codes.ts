import type { ExitCodes } from "../tool-run.ts";

// The exit code the tool documents for "the requested stack does not exist,
// cannot be found, or no stack is selected" (Pulumi docs, CLI exit codes). The
// mapping is fixed from v3.226.1 on, below the minimum version (record 0001).
// A stack is always passed, so for a preview it means that the backend holds
// no such stack. The recorded missing-stack scenario shows it on both versions.
export const STACK_NOT_FOUND_EXIT_CODE = 6;

// What the preview, the drift check and the tool diff make of the tool's
// exit codes. Besides 6, the other documented codes with a reason of their
// own (slice 5.9): 2 configuration and validation, 3 authentication or
// authorization, 4 a resource operation, 9 a time limit of the tool's. Every
// other code but 0 stays a tool error with the code on the row.
export const PULUMI_EXIT_CODES: ExitCodes = {
  reasons: {
    2: { kind: "configuration-error" },
    3: { kind: "authentication-error" },
    4: { kind: "resource-error" },
    [STACK_NOT_FOUND_EXIT_CODE]: { kind: "stack-not-found" },
    9: { kind: "tool-timed-out" },
  },
};

// The read of the tool's history (record 0073) gives 6 alone a reason of its
// own. Slice 5.9 gave the other codes theirs on the preview, the drift check
// and the tool diff, and not here.
export const HISTORY_EXIT_CODES: ExitCodes = {
  reasons: { [STACK_NOT_FOUND_EXIT_CODE]: { kind: "stack-not-found" } },
};
