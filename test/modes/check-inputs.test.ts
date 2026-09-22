import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tools } from "../../src/adapters/tools.ts";
import { check } from "../../src/modes/check.ts";
import { rememberingLog } from "./harness.ts";

// Slice 5.7, record 0074: the check suggests `inputs` from the files a stack's
// own files name. A Pulumi YAML program's fn::readFile, fn::fileAsset and
// fn::fileArchive, a plain stack config value that is the path of a file of
// the repo, and a Helm stack's local chart and values files. It never applies
// a suggestion, and it reads files only.

const ROOT = resolve(import.meta.dir, "../..");

type Files = Record<string, string | undefined>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-inputs-"));
  for (const [file, text] of Object.entries(files)) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

// A copy of an example project, with its sluiceway.yaml replaced when asked.
function example(name: string, config?: string): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-inputs-"));
  cpSync(join(ROOT, "examples", name), root, { recursive: true });
  if (config !== undefined) writeFileSync(join(root, "sluiceway.yaml"), config);
  return root;
}

async function run(root: string) {
  const log = rememberingLog();
  await check({ root, adapter: tools, log });
  return {
    log,
    summary: log.summaries.at(-1) ?? "",
    group: (title: string) => log.groups.find((group) => group.title === title)?.lines,
  };
}

const READS = "Files stacks read and do not claim";
const PASTE = "Ready to paste into sluiceway.yaml, under stacks";

describe("the example projects", () => {
  test("pulumi-basic claims what its programs read, so nothing is suggested", async () => {
    const { group, summary } = await run(example("pulumi-basic"));
    expect(group(READS)).toBeUndefined();
    expect(summary).not.toContain("### Files stacks read");
  });

  test("pulumi-basic without its inputs: app reads shared/motd.txt", async () => {
    const config = readFileSync(join(ROOT, "examples/pulumi-basic/sluiceway.yaml"), "utf8");
    const { group, log, summary } = await run(
      example(
        "pulumi-basic",
        config.replace(/ {2}- path: app\n {4}inputs:\n {6}- shared\/\*\*\n/, ""),
      ),
    );
    expect(group(READS)).toEqual([
      "app:prod reads shared/motd.txt, named in app/program/Main.yaml.",
    ]);
    expect(group(PASTE)).toEqual([
      "stacks:",
      '  - path: "app"',
      "    inputs:",
      '      - "shared/motd.txt"',
    ]);
    // The file is claimed by no stack, so a push that changes it gives a full
    // scan today: worth knowing, not a warning.
    expect(log.warnings).toEqual([]);
    expect(summary).toContain("### Files stacks read and do not claim");
    expect(summary).toContain('      - "shared/motd.txt"');
  });

  test("helm-basic claims its charts, so nothing is suggested", async () => {
    const { group } = await run(example("helm-basic"));
    expect(group(READS)).toBeUndefined();
  });

  test("helm-basic without its inputs: each release reads its chart", async () => {
    const config = readFileSync(join(ROOT, "examples/helm-basic/sluiceway.yaml"), "utf8");
    const { group } = await run(
      example("helm-basic", config.replace(/ {4}inputs:\n {6}- charts\/[a-z/*]+\n/g, "")),
    );
    expect(group(READS)).toEqual([
      "web reads charts/web/, named in sluiceway.yaml.",
      "worker reads charts/worker/, named in sluiceway.yaml.",
    ]);
    expect(group(PASTE)).toEqual([
      "stacks:",
      '  - path: "web"',
      "    inputs:",
      '      - "charts/web/**"',
      '  - path: "worker"',
      "    inputs:",
      '      - "charts/worker/**"',
    ]);
  });
});

const project = (name: string, rest = "") => `name: ${name}\nruntime: yaml\n${rest}`;

describe("what a Pulumi stack's files name", () => {
  test("a stack config value that is the path of a file, for that stack only", async () => {
    const { group } = await run(
      repo({
        "infra/Pulumi.yaml": project("infra"),
        "infra/Pulumi.dev.yaml": "config:\n  infra:values: ../shared/dev.json\n  infra:zone: a/b\n",
        "infra/Pulumi.prod.yaml": "config:\n  infra:zone: c\n",
        "shared/dev.json": "{}",
      }),
    );
    // "a/b" is no file of the repo, so it is a value like any other.
    expect(group(READS)).toEqual([
      "infra:dev reads shared/dev.json, named in infra/Pulumi.dev.yaml.",
    ]);
    expect(group(PASTE)).toEqual([
      "stacks:",
      '  - path: "infra"',
      '    name: "dev"',
      "    inputs:",
      '      - "shared/dev.json"',
    ]);
  });

  test("a secret config value is never read", async () => {
    const { group } = await run(
      repo({
        "infra/Pulumi.yaml": project("infra"),
        "infra/Pulumi.dev.yaml": "config:\n  infra:key:\n    secure: ../shared/dev.json\n",
        "shared/dev.json": "{}",
      }),
    );
    expect(group(READS)).toBeUndefined();
  });

  test("a default in the project file, and an asset and an archive of the program", async () => {
    const { group } = await run(
      repo({
        "infra/Pulumi.yaml": project(
          "infra",
          [
            "config:",
            "  policy:",
            "    type: string",
            "    default: ../policies/base.json",
            "resources:",
            "  site:",
            "    type: aws:s3:BucketObject",
            "    properties:",
            "      source:",
            "        fn::fileAsset: ../web/index.html",
            "  lambda:",
            "    type: aws:lambda:Function",
            "    properties:",
            "      code:",
            "        fn::fileArchive: ../functions/hello",
            "  unknown:",
            "    type: aws:s3:BucketObject",
            "    properties:",
            "      content:",
            "        fn::readFile: ${stack}/../x.txt",
            "",
          ].join("\n"),
        ),
        "infra/Pulumi.dev.yaml": "",
        "policies/base.json": "{}",
        "web/index.html": "",
        "functions/hello/index.js": "",
      }),
    );
    // An interpolation other than pulumi.cwd is only known at run time.
    expect(group(READS)).toEqual([
      "infra:dev reads functions/hello/, named in infra/Pulumi.yaml.",
      "infra:dev reads policies/base.json, named in infra/Pulumi.yaml.",
      "infra:dev reads web/index.html, named in infra/Pulumi.yaml.",
    ]);
    expect(group(PASTE)).toEqual([
      "stacks:",
      '  - path: "infra"',
      "    inputs:",
      '      - "functions/hello/**"',
      '      - "policies/base.json"',
      '      - "web/index.html"',
    ]);
  });

  test("a path outside the repo, or one that is not there, is left alone", async () => {
    const { group } = await run(
      repo({
        "infra/Pulumi.yaml": project(
          "infra",
          "variables:\n  a:\n    fn::readFile: ../../../etc/hosts\n  b:\n    fn::readFile: ../gone.txt\n",
        ),
        "infra/Pulumi.dev.yaml": "",
      }),
    );
    expect(group(READS)).toBeUndefined();
  });

  test("a file another stack claims is a warning: a push that changes it skips this stack", async () => {
    const { log } = await run(
      repo({
        "infra/Pulumi.yaml": project(
          "infra",
          "variables:\n  a:\n    fn::readFile: ../base/motd.txt\n",
        ),
        "infra/Pulumi.dev.yaml": "",
        "base/Pulumi.yaml": project("base"),
        "base/Pulumi.dev.yaml": "",
        "base/motd.txt": "",
      }),
    );
    expect(log.warnings).toEqual([
      {
        title: "A stack reads a file it does not claim",
        message:
          "infra:dev reads base/motd.txt, named in infra/Pulumi.yaml. A push that changes it does not preview infra:dev. Add it to the inputs of the stack.",
      },
    ]);
  });

  test("a file under scan.unrelated is a warning too", async () => {
    const { log } = await run(
      repo({
        "sluiceway.yaml": 'scan:\n  unrelated: ["docs/**"]\n',
        "infra/Pulumi.yaml": project(
          "infra",
          "variables:\n  a:\n    fn::readFile: ../docs/motd.md\n",
        ),
        "infra/Pulumi.dev.yaml": "",
        "docs/motd.md": "",
      }),
    );
    expect(log.warnings.map((warning) => warning.title)).toEqual([
      "A stack reads a file it does not claim",
    ]);
  });
});
