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

// The helm versions of test/fixtures/helm/ (record 0058), each with the
// version of the diff plugin it was recorded with: the minimums the adapter
// supports, and the newest at the time of recording. The matrix of the
// fixtures job in .github/workflows/ci.yml has to agree. A test checks it.
export const FIXTURE_HELM_VERSIONS = {
  minimum: { helm: "v3.18.0", diff: "v3.15.11" },
  newest: { helm: "v4.3.0", diff: "v3.15.13" },
} as const;

// The kubectl versions of test/fixtures/kubectl/ (record 0060): the minimum
// the adapter supports, and the newest at the time of recording. Each is
// recorded against a kind cluster of its own minor version. The matrix of the
// fixtures job in .github/workflows/ci.yml has to agree. A test checks it.
export const FIXTURE_KUBECTL_VERSIONS = {
  minimum: "v1.34.0",
  newest: "v1.37.0",
} as const;

// The versions of the Terraform family (record 0068), each the minimum the
// adapter supports and the newest at the time of recording: terraform under
// test/fixtures/terraform/, and terragrunt and cdktf, with tofu behind them,
// under test/fixtures/terragrunt/ and test/fixtures/cdktf/. cdktf had its
// last release before it was archived, so it has one. The matrix of the
// fixtures job in .github/workflows/ci.yml has to agree. A test checks it.
export const FIXTURE_TERRAFORM_VERSIONS = {
  minimum: "v1.14.0",
  newest: "v1.16.3",
} as const;

export const FIXTURE_TERRAGRUNT_VERSIONS = {
  minimum: "v1.0.0",
  newest: "v1.1.6",
} as const;

export const FIXTURE_CDKTF_VERSIONS = {
  minimum: "v0.21.0",
  newest: "v0.21.0",
} as const;

// The tofu behind terragrunt and cdktf in their recordings.
export const FIXTURE_WRAPPED_TOFU_VERSION = "v1.12.6";

// The Infracost CLI version of test/fixtures/infracost/ (record 0105): the
// last release of the open source 0.10 line, whose `diff` reads a plan's JSON
// and asks only the pricing API. The adapter checks no floor, because a
// failed estimate is a missing line and never a red scan, so there is one
// set. The matrix of the fixtures job in .github/workflows/ci.yml and the
// tofu it installs have to agree. A test checks it.
export const FIXTURE_INFRACOST_VERSIONS = {
  minimum: "v0.10.45",
  newest: "v0.10.45",
} as const;
