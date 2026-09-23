#!/usr/bin/env bash
# Publishes the npm package from the release checkout (record 0094), for the
# npm job of release.yml. The release is done before this runs, so only a real
# failure turns the run red (slice 5.32):
#
#   - a bundle that does not run, or names another version, fails;
#   - a version already on npm is said and is not an error, as on a re-run;
#   - a publish npm refuses because it does not trust this workflow yet
#     (ENEEDAUTH, E401, E403, E404) is a warning with what to set on npmjs.com;
#   - any other failure of the publish fails.
#
#   scripts/ci/publish-npm.sh
set -uo pipefail

name="$(jq -r .name package.json)"
version="$(jq -r .version package.json)"

if ! bundle_version="$(node dist/cli.js --version 2>&1)" || [ "$bundle_version" != "$version" ]; then
  echo "$bundle_version"
  echo "::error title=npm package is broken::dist/cli.js did not print $version for --version, so $name was not published."
  exit 1
fi

already() {
  echo "$name $version is already on npm. Nothing to publish."
  exit 0
}

if [ "$(npm view "$name@$version" version 2>/dev/null)" = "$version" ]; then
  already
fi

# The bundle holds every package it runs, so the published package.json names
# none, and npx installs nothing but the bundle.
npm pkg delete dependencies devDependencies scripts || exit 1

log="$(mktemp)"
npm publish 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -eq 0 ]; then
  echo "Published $name $version."
  exit 0
fi

if grep -q "previously published version" "$log"; then
  already
fi

code="$(grep -oE '^npm error code [A-Z0-9]+' "$log" | head -n1 | awk '{print $4}')"
case "$code" in
  ENEEDAUTH | E401 | E403 | E404)
    owner="${GITHUB_REPOSITORY%%/*}"
    repo="${GITHUB_REPOSITORY#*/}"
    workflow="${GITHUB_WORKFLOW_REF%%@*}"
    workflow="${workflow##*/}"
    echo "::warning title=npm package not published::npm refused to publish $name $version ($code) because it does not trust this workflow yet. The release itself is done. The job log says what to set on npmjs.com."
    cat <<EOF

$name $version was not published to npm. npm answered $code, which means it does
not trust this workflow to publish $name yet. The release, its tags and the
action are done; only the npm package is missing.

To publish from this workflow, open the package $name on npmjs.com, go to
Settings, Trusted publishing, and add GitHub Actions with exactly:

  Organization or user: $owner
  Repository: $repo
  Workflow filename: $workflow
  Environment name: leave it empty
  Allowed actions: npm publish, not only npm stage publish

Publishing access, on the same Settings page, must allow a trusted publisher to
publish. npm advises "Require two-factor authentication and disallow tokens"
together with a trusted publisher: it refuses every token and still lets this
workflow publish. No automation token or secret is needed.

Or set it up from a terminal, logged in to npm as an owner of $name, with npm
11.15 or newer:

  npm trust github $name --repo $owner/$repo --file $workflow --allow-publish

npm trust list $name shows what is set up now, and npm trust revoke removes a
publisher that is wrong.
EOF
    if [ "$code" = "E404" ]; then
      cat <<EOF

npm adds a trusted publisher only to a package that exists. When $name is not
on npm yet, publish a first version of it by hand, then add the publisher.
EOF
    fi
    cat <<EOF

Then run this job again. It publishes $version, or says it is already there.
EOF
    exit 0
    ;;
esac

echo "::error title=npm publish failed::npm could not publish $name $version (${code:-exit $status}). See npm's own words above."
exit "$status"
