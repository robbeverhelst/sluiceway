import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../docs/docs.ts";

// Slice 5.32: the npm job of the release workflow runs this script. A publish
// npm refuses because it does not trust the workflow yet is a warning, a
// version already on npm is fine, and anything else still fails the run.

const SCRIPT = join(ROOT, "scripts/ci/publish-npm.sh");

type Npm = {
  // What `npm view <name>@<version> version` prints and its exit code.
  view?: { out: string; code: number };
  // What `npm publish` writes to stderr and its exit code.
  publish?: { err: string; code: number };
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A release checkout with the committed bundle, and an npm on PATH that
// answers as told and writes down every command it was given.
function checkout(bundle: string | null = readFileSync(join(ROOT, "dist/cli.js"), "utf8")): string {
  const dir = mkdtempSync(join(tmpdir(), "sluiceway-publish-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "sluiceway", version: "0.28.0", dependencies: { zod: "4.6.5" } }),
  );
  if (bundle !== null) {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist/cli.js"), bundle);
  }
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // The runner's node is bun here: the bundle really runs.
  writeFileSync(join(bin, "node"), '#!/usr/bin/env bash\nexec bun "$@"\n');
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env bash
echo "npm $*" >> "$FAKE_NPM_LOG"
case "$1" in
  view) printf '%s' "$FAKE_VIEW_OUT"; exit "$FAKE_VIEW_CODE" ;;
  publish) printf '%s\\n' "$FAKE_PUBLISH_ERR" >&2; exit "$FAKE_PUBLISH_CODE" ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(join(bin, "node"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);
  return dir;
}

function publish(dir: string, npm: Npm) {
  const log = join(dir, "npm.log");
  writeFileSync(log, "");
  const run = Bun.spawnSync(["bash", SCRIPT], {
    cwd: dir,
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "sluiceway/sluiceway",
      GITHUB_WORKFLOW_REF: "sluiceway/sluiceway/.github/workflows/release.yml@refs/heads/main",
      FAKE_NPM_LOG: log,
      FAKE_VIEW_OUT: npm.view?.out ?? "",
      FAKE_VIEW_CODE: String(npm.view?.code ?? 0),
      FAKE_PUBLISH_ERR: npm.publish?.err ?? "",
      FAKE_PUBLISH_CODE: String(npm.publish?.code ?? 0),
    },
  });
  return {
    code: run.exitCode,
    out: run.stdout.toString() + run.stderr.toString(),
    npm: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
  };
}

// What npm 11 wrote in run 35884043091, the first release with the npm job.
const REFUSED = `npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/sluiceway - OIDC permission denied for this action
npm error 403 In most cases, you or one of your dependencies are requesting a package version that is forbidden by your security policy, or on a server you do not have access to.`;

describe("a publish npm refuses because it does not trust the workflow", () => {
  test("403: a warning on the run, the job stays green, and the log says what to set on npmjs.com", () => {
    const run = publish(checkout(), {
      view: { out: "", code: 0 },
      publish: { err: REFUSED, code: 1 },
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain("::warning title=npm package not published::");
    expect(run.out).toContain("sluiceway 0.28.0 was not published to npm");
    expect(run.out).toContain("Organization or user: sluiceway");
    expect(run.out).toContain("Repository: sluiceway");
    expect(run.out).toContain("Workflow filename: release.yml");
    expect(run.out).toContain("Environment name: leave it empty");
    expect(run.out).toContain("Allowed actions: npm publish");
    expect(run.out).toContain("Publishing access");
    // npm's own words stay in the log above ours.
    expect(run.out).toContain("OIDC permission denied for this action");
    expect(run.npm).toContain("npm publish");
  });

  test("404: the package is not on npm, and the log says a first version comes first", () => {
    const run = publish(checkout(), {
      view: { out: "", code: 1 },
      publish: {
        err: "npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/sluiceway - Not found",
        code: 1,
      },
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain("::warning title=npm package not published::");
    expect(run.out).toContain("Workflow filename: release.yml");
    expect(run.out).toContain("only to a package that exists");
  });

  test("ENEEDAUTH, npm's answer when no trusted publisher matches: a warning too", () => {
    const run = publish(checkout(), {
      publish: {
        err: "npm error code ENEEDAUTH\nnpm error need auth This command requires you to be logged in",
        code: 1,
      },
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain("::warning title=npm package not published::");
  });

  test("the fields follow the repository and the workflow file the run came from", () => {
    const dir = checkout();
    const log = join(dir, "npm.log");
    writeFileSync(log, "");
    const run = Bun.spawnSync(["bash", SCRIPT], {
      cwd: dir,
      env: {
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "acme/tools",
        GITHUB_WORKFLOW_REF: "acme/tools/.github/workflows/ship.yaml@refs/heads/main",
        FAKE_NPM_LOG: log,
        FAKE_VIEW_OUT: "",
        FAKE_VIEW_CODE: "0",
        FAKE_PUBLISH_ERR: REFUSED,
        FAKE_PUBLISH_CODE: "1",
      },
    });
    const out = run.stdout.toString();
    expect(run.exitCode).toBe(0);
    expect(out).toContain("Organization or user: acme");
    expect(out).toContain("Repository: tools");
    expect(out).toContain("Workflow filename: ship.yaml");
  });
});

describe("a version already on npm", () => {
  test("says it is there and publishes nothing, as a re-run of a release does", () => {
    const run = publish(checkout(), { view: { out: "0.28.0\n", code: 0 } });
    expect(run.code).toBe(0);
    expect(run.out).toContain("sluiceway 0.28.0 is already on npm");
    expect(run.out).not.toContain("::warning");
    expect(run.npm.some((line) => line.startsWith("npm publish"))).toBe(false);
  });

  test("npm's refusal to publish over a version is the same answer, not a failure", () => {
    const run = publish(checkout(), {
      publish: {
        err: "npm error code E403\nnpm error 403 403 Forbidden - PUT https://registry.npmjs.org/sluiceway - You cannot publish over the previously published versions: 0.28.0.",
        code: 1,
      },
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain("sluiceway 0.28.0 is already on npm");
    expect(run.out).not.toContain("::warning");
  });
});

describe("anything else still fails the run", () => {
  test("a publish npm refuses for another reason", () => {
    const run = publish(checkout(), {
      publish: {
        err: "npm error code E400\nnpm error 400 Bad Request - PUT https://registry.npmjs.org/sluiceway",
        code: 1,
      },
    });
    expect(run.code).not.toBe(0);
    expect(run.out).toContain("::error title=npm publish failed::");
    expect(run.out).not.toContain("::warning");
  });

  test("a network failure", () => {
    const run = publish(checkout(), {
      publish: { err: "npm error code ECONNRESET\nnpm error network aborted", code: 1 },
    });
    expect(run.code).not.toBe(0);
    expect(run.out).toContain("::error title=npm publish failed::");
  });

  test("a bundle that does not run: nothing is published", () => {
    const run = publish(checkout('throw new Error("broken");\n'), {});
    expect(run.code).not.toBe(0);
    expect(run.out).toContain("::error title=npm package is broken::");
    expect(run.npm.some((line) => line.startsWith("npm publish"))).toBe(false);
  });

  test("no bundle at all: nothing is published", () => {
    const run = publish(checkout(null), {});
    expect(run.code).not.toBe(0);
    expect(run.out).toContain("::error title=npm package is broken::");
    expect(run.npm.some((line) => line.startsWith("npm publish"))).toBe(false);
  });

  test("a bundle that names another version: nothing is published", () => {
    const run = publish(checkout('console.log("0.1.0");\n'), {});
    expect(run.code).not.toBe(0);
    expect(run.out).toContain("::error title=npm package is broken::");
    expect(run.npm.some((line) => line.startsWith("npm publish"))).toBe(false);
  });
});

describe("a publish that works", () => {
  test("takes the dependencies out of the package file, publishes, and says so", () => {
    const run = publish(checkout(), { view: { out: "", code: 1 } });
    expect(run.code).toBe(0);
    expect(run.npm).toContain("npm pkg delete dependencies devDependencies scripts");
    expect(run.npm).toContain("npm publish");
    expect(run.npm.indexOf("npm pkg delete dependencies devDependencies scripts")).toBeLessThan(
      run.npm.indexOf("npm publish"),
    );
    expect(run.out).toContain("Published sluiceway 0.28.0");
  });
});
