// The CLI versions the fixtures are recorded with (build plan, section 6): the
// minimum that record 0001 supports, and the newest at the time of recording.
// The matrix in .github/workflows/ci.yml and the directories under
// test/fixtures/pulumi/ have to agree with this. A test checks both.
export const FIXTURE_CLI_VERSIONS = {
  minimum: "v3.229.0",
  newest: "v3.263.0",
} as const;

// The OpenTofu versions of test/fixtures/opentofu/ (record 0053): the minimum
// the adapter supports, and the newest at the time of recording. The matrix of
// the fixtures job in .github/workflows/ci.yml has to agree. A test checks it.
export const FIXTURE_TOFU_VERSIONS = {
  minimum: "v1.11.0",
  newest: "v1.12.6",
} as const;
