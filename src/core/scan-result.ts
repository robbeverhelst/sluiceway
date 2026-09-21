// When a scan could not do its work (record 0012): every attempted preview
// failed, and more than one was attempted. That nearly always means a broken
// environment, such as missing credentials or a backend out of reach. A repo
// with one stack never goes red for it, and neither does one broken stack
// among many: a job that is red on every push teaches people to ignore red.
export function everyPreviewFailed(attempted: number, failed: number): boolean {
  return attempted > 1 && failed === attempted;
}
