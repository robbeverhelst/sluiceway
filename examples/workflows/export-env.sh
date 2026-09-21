#!/usr/bin/env bash
# Loads an env file of secret references into the job environment, masked.
# Run it inside your secret manager's `run` command, which resolves every
# reference of the file into this process's environment, for example:
#
#   op run --env-file=ci.env --no-masking -- bash export-env.sh ci.env
#
# It prints nothing but ::add-mask:: commands. Never add `set -x` or an echo.
set -euo pipefail
file="$1"
# A line whose value holds this is a secret. Every other line is a plain value.
reference="${SECRET_REFERENCE:-op://}"

while IFS= read -r raw || [ -n "$raw" ]; do
  raw="${raw%$'\r'}"
  # Take NAME from lines like `NAME=...`, `NAME = ...` or `export NAME=...`.
  [[ "$raw" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]] || continue
  name="${BASH_REMATCH[2]}"
  # The secret manager's own token and settings stay on this step, and the
  # runner does not let a step set its own names.
  case "$name" in OP_* | GITHUB_* | RUNNER_*) continue ;; esac
  value="${!name-}"
  [ -n "$value" ] || continue

  # Mask first, every line on its own, because the log is matched line by line.
  if [[ "$raw" == *"$reference"* ]]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      [ -n "$line" ] || continue
      printf '::add-mask::%s\n' "${line//%/%25}"
    done <<<"$value"
  fi

  # Then write, in the delimiter form so that newlines survive.
  delimiter="ghadelimiter_$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  if [[ "$value" == *"$delimiter"* ]]; then
    echo "The value of $name holds the delimiter. Run the step again." >&2
    exit 1
  fi
  printf '%s<<%s\n%s\n%s\n' "$name" "$delimiter" "$value" "$delimiter" >>"$GITHUB_ENV"
done <"$file"
