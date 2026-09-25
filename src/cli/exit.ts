// The exit codes of the command line (records 0094 and 0116), so an agent can
// act on how a command ended without reading its words.
export const EXIT = {
  // The command did what it says.
  ok: 0,
  // It ran and failed: a check that fails, an app that cannot be reached, a
  // deploy record that failed.
  failed: 1,
  // A command line that was not understood, and a mode that runs only in the
  // workflow.
  usage: 2,
  // No token, or one that does not work: sign in again.
  signedOut: 3,
  // The repo or stack is not there, or not in the token's org.
  notFound: 4,
  // The app said no: a tick or a rescan refused, changes refused, a destroy
  // without --yes.
  refused: 5,
  // Not now: a spent rate limit, GitHub silent, a record not shown yet. The
  // same command may work later.
  later: 6,
} as const;
