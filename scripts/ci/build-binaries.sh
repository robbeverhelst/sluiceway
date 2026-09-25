#!/usr/bin/env bash
# The command line as standalone binaries (record 0116), one per target, for a
# machine with no Node. release.yml builds them from the release tag, with the
# version compiled in, since a binary has no package.json beside it, and
# uploads them with their checksums.
#
#   scripts/ci/build-binaries.sh <out dir> [host]
#
# With host, only the binary of this machine is built, as the tests do.
set -euo pipefail

out="${1:?name the directory to write the binaries to}"
only="${2:-}"
version="$(bun -e 'console.log(require("./package.json").version)')"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) host=linux-x64 ;;
  Linux-aarch64 | Linux-arm64) host=linux-arm64 ;;
  Darwin-x86_64) host=darwin-x64 ;;
  Darwin-arm64) host=darwin-arm64 ;;
  *) host="" ;;
esac

targets=(linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64)
if [[ "$only" == host ]]; then
  if [[ -z "$host" ]]; then
    echo "No binary is built for $(uname -s) $(uname -m)." >&2
    exit 1
  fi
  targets=("$host")
fi

mkdir -p "$out"
for target in "${targets[@]}"; do
  name="sluiceway-$target"
  if [[ "$target" == windows-* ]]; then name="$name.exe"; fi
  bun build src/cli.ts --compile --target="bun-$target" \
    --define "SLUICEWAY_VERSION=\"$version\"" --outfile "$out/$name"
done

# The binary of the machine that built them proves the version went in.
if [[ -n "$host" && -x "$out/sluiceway-$host" ]]; then
  printed="$("$out/sluiceway-$host" --version)"
  if [[ "$printed" != "$version" ]]; then
    echo "sluiceway-$host printed $printed, and the release is $version." >&2
    exit 1
  fi
fi

cd "$out"
if command -v sha256sum >/dev/null; then
  sha256sum sluiceway-* >SHA256SUMS
else
  shasum -a 256 sluiceway-* >SHA256SUMS
fi
cat SHA256SUMS
