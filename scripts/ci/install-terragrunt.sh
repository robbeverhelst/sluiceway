#!/usr/bin/env bash
# Installs one terragrunt release for CI (record 0068): the linux_amd64
# binary, checked against the release's own SHA256SUMS, into a directory that
# is added to PATH for the steps after this one.
#
#   scripts/ci/install-terragrunt.sh v1.1.6 "$RUNNER_TEMP/terragrunt"
set -euo pipefail

version="$1"
dir="$2"
base="https://github.com/gruntwork-io/terragrunt/releases/download/$version"

mkdir -p "$dir"
cd "$dir"
curl --fail --silent --show-error --location --output terragrunt_linux_amd64 "$base/terragrunt_linux_amd64"
curl --fail --silent --show-error --location --output SHA256SUMS "$base/SHA256SUMS"
grep ' terragrunt_linux_amd64$' SHA256SUMS | sha256sum --check --strict
mv terragrunt_linux_amd64 terragrunt
chmod +x terragrunt
rm SHA256SUMS
echo "$dir" >> "$GITHUB_PATH"
