import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { type Cloud, type CredentialNeed, cloudWays, regionWays } from "../../core/credentials.ts";
import type { Stack } from "../../core/stack.ts";
import { type HclBlock, readHcl } from "./hcl.ts";
import { CDKTF, TERRAGRUNT } from "./options.ts";

// What a stack of the Terraform family says, in its own files, the tool will
// want from the job environment (record 0099), for the check. Read with the
// HCL reader of root module discovery, from the files alone: block labels,
// attribute names, and the one plain string of a source or a hostname. No
// default, no var file value and no backend setting leaves this file.
//
// - The providers: the lock file's labels first, then `required_providers`,
//   then `provider` blocks, each provider once, from the first that names it.
// - The backend: the label of the `backend` block, or a `cloud` block and
//   the token of its host.
// - The variables: one without a default that no var file the stack takes,
//   and no var file the tool loads by itself, sets.
// - A Terragrunt unit: its `remote_state`, and the providers of the module
//   its source names when that is a directory of the repo.
// - A CDK for Terraform app: the providers `cdktf.json` lists. Its backend is
//   set in code, which the check does not read.

// The provider's own name, and the cloud its credentials come from.
// `nothing` is a provider that needs no credential. A provider that is not
// here is one the check has no table for, and it says so.
const PROVIDERS: Record<string, Cloud | "nothing"> = {
  aws: "aws",
  awscc: "aws",
  google: "google",
  "google-beta": "google",
  azurerm: "azure",
  azuread: "azure",
  azapi: "azure",
  kubernetes: "kubernetes",
  helm: "kubernetes",
  cloudflare: "cloudflare",
  digitalocean: "digitalocean",
  github: "github",
  hcloud: "hcloud",
  linode: "linode",
  vault: "vault",
  vultr: "vultr",
  random: "nothing",
  null: "nothing",
  local: "nothing",
  tls: "nothing",
  time: "nothing",
  archive: "nothing",
  external: "nothing",
  http: "nothing",
  terraform: "nothing",
  assert: "nothing",
};

// The label of a backend block, and what it needs.
const BACKENDS: Record<string, Cloud | "nothing" | CredentialNeed["ways"]> = {
  s3: "aws",
  gcs: "google",
  azurerm: "azure",
  kubernetes: "kubernetes",
  local: "nothing",
  remote: [{ names: ["TF_TOKEN_app_terraform_io"] }],
  pg: [{ names: ["PG_CONN_STR"] }],
  consul: [{ names: ["CONSUL_HTTP_TOKEN"] }],
};

const MODULE_FILE = /\.(tf|tofu)$/;
const LOCK_FILE = ".terraform.lock.hcl";
const AUTO_VAR_FILE = /^terraform\.tfvars(\.json)?$|\.auto\.tfvars(\.json)?$/;

export async function credentialNeeds(root: string, stack: Stack): Promise<CredentialNeed[]> {
  const { wrapper, varFiles } = stack.options;
  if (wrapper === TERRAGRUNT) return terragruntNeeds(root, stack.path);
  if (wrapper === CDKTF) return cdktfNeeds(root, stack.path);
  const files = Array.isArray(varFiles) ? varFiles.filter((f) => typeof f === "string") : [];
  return rootModuleNeeds(root, stack.path, files);
}

function rootModuleNeeds(root: string, path: string, varFiles: string[]): CredentialNeed[] {
  const directory = readDirectory(root, path);
  const needs: CredentialNeed[] = [];
  const backend = backendNeed(directory);
  if (backend !== undefined) needs.push(backend);
  needs.push(...providerNeeds(directory));

  // The variables without a default, minus the ones a var file sets.
  const set = new Set<string>();
  const chosen = varFiles.map((file) => posix.join(path, file));
  const auto = directory.files.filter((file) => AUTO_VAR_FILE.test(posix.basename(file)));
  for (const file of [...chosen, ...auto]) for (const name of varNames(root, file)) set.add(name);
  for (const { file, blocks } of directory.code) {
    for (const block of blocks) {
      if (block.type !== "variable" || block.attributes.includes("default")) continue;
      const [name] = block.labels;
      if (name === undefined || set.has(name)) continue;
      needs.push({
        what: `the variable ${name}`,
        namedIn: file,
        ways: [{ names: [`TF_VAR_${name}`] }],
      });
    }
  }
  return needs;
}

function terragruntNeeds(root: string, path: string): CredentialNeed[] {
  const file = ["terragrunt.hcl", "terragrunt.hcl.json"]
    .map((name) => posix.join(path, name))
    .find((name) => text(join(root, name)) !== "");
  if (file === undefined || file.endsWith(".json")) return [];
  const { blocks } = readHcl(text(join(root, file)));
  const needs: CredentialNeed[] = [];
  const remote = blocks.find((block) => block.type === "remote_state");
  const label = remote?.strings.backend;
  if (label !== undefined) {
    const known = BACKENDS[label];
    if (known !== "nothing") {
      needs.push({ what: `the ${label} remote state`, namedIn: file, ways: waysOf(known) });
    }
  }
  const source = blocks.find((block) => block.type === "terraform")?.strings.source;
  const module = source === undefined ? undefined : localSource(path, source);
  if (module !== undefined) needs.push(...providerNeeds(readDirectory(root, module)));
  return needs;
}

function cdktfNeeds(root: string, path: string): CredentialNeed[] {
  const file = posix.join(path, "cdktf.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(join(root, file)));
  } catch {
    return [];
  }
  const listed =
    typeof parsed === "object" && parsed !== null && "terraformProviders" in parsed
      ? parsed.terraformProviders
      : undefined;
  const needs: CredentialNeed[] = [
    { what: "the backend the app sets in code", namedIn: file, ways: [] },
  ];
  const named = new Map<string, string>();
  for (const entry of Array.isArray(listed) ? listed : []) {
    const spec =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name
          : undefined;
    if (spec === undefined) continue;
    const name = (spec.split("@")[0] ?? "").split("/").at(-1) ?? "";
    if (name !== "" && !named.has(name)) named.set(name, file);
  }
  needs.push(...needsOf(named, new Set()));
  return needs;
}

interface Directory {
  files: string[];
  lock: { file: string; blocks: HclBlock[] } | undefined;
  code: { file: string; blocks: HclBlock[] }[];
}

// The files of a directory of the repo, parsed. Paths are repo paths.
function readDirectory(root: string, path: string): Directory {
  let names: string[];
  try {
    names = readdirSync(join(root, path)).sort(byCodeUnit);
  } catch {
    names = [];
  }
  const at = (name: string) => posix.join(path, name);
  const parsed = (name: string) => ({
    file: at(name),
    blocks: readHcl(text(join(root, at(name)))).blocks,
  });
  return {
    files: names.map(at),
    lock: names.includes(LOCK_FILE) ? parsed(LOCK_FILE) : undefined,
    code: names.filter((name) => MODULE_FILE.test(name)).map(parsed),
  };
}

// The providers, each with the first file that names it, and the ones whose
// block sets a region.
function providerNeeds(directory: Directory): CredentialNeed[] {
  const named = new Map<string, string>();
  const name = (provider: string, file: string) => {
    if (provider !== "" && !named.has(provider)) named.set(provider, file);
  };
  if (directory.lock !== undefined) {
    for (const block of directory.lock.blocks.filter((one) => one.type === "provider")) {
      name(block.labels[0]?.split("/").at(-1) ?? "", directory.lock.file);
    }
  }
  for (const { file, blocks } of directory.code) {
    for (const block of blocks.filter((one) => one.type === "terraform")) {
      for (const inner of block.blocks.filter((one) => one.type === "required_providers")) {
        for (const provider of inner.attributes) name(provider, file);
      }
    }
  }
  const regionSet = new Set<string>();
  for (const { file, blocks } of directory.code) {
    for (const block of blocks.filter((one) => one.type === "provider")) {
      const [label] = block.labels;
      if (label === undefined) continue;
      name(label, file);
      if (block.attributes.includes("region")) regionSet.add(label);
    }
  }
  return needsOf(named, regionSet);
}

// The needs of named providers: the credentials of each, and a region for
// one whose provider block does not set it.
function needsOf(named: Map<string, string>, regionSet: Set<string>): CredentialNeed[] {
  const needs: CredentialNeed[] = [];
  for (const [provider, namedIn] of named) {
    const cloud = PROVIDERS[provider];
    if (cloud === "nothing") continue;
    needs.push({
      what: `the ${provider} provider`,
      namedIn,
      ways: cloud === undefined ? [] : cloudWays(cloud),
    });
    const region = cloud === undefined ? undefined : regionWays(cloud);
    if (region !== undefined && !regionSet.has(provider)) {
      needs.push({ what: `a region for the ${provider} provider`, namedIn, ways: region });
    }
  }
  return needs;
}

function backendNeed(directory: Directory): CredentialNeed | undefined {
  for (const { file, blocks } of directory.code) {
    for (const block of blocks.filter((one) => one.type === "terraform")) {
      for (const inner of block.blocks) {
        if (inner.type === "backend") {
          const [label] = inner.labels;
          if (label === undefined) continue;
          const known = BACKENDS[label];
          if (known === "nothing") return undefined;
          return { what: `the ${label} backend`, namedIn: file, ways: waysOf(known) };
        }
        if (inner.type === "cloud") {
          const host = inner.strings.hostname ?? "app.terraform.io";
          return {
            what: "the cloud block",
            namedIn: file,
            ways: [{ names: [`TF_TOKEN_${host.replaceAll(".", "_").replaceAll("-", "__")}`] }],
          };
        }
      }
    }
  }
  return undefined;
}

function waysOf(
  known: Cloud | "nothing" | CredentialNeed["ways"] | undefined,
): CredentialNeed["ways"] {
  if (known === undefined || known === "nothing") return [];
  return typeof known === "string" ? cloudWays(known) : known.map((way) => ({ ...way }));
}

// The names a var file sets. A JSON var file is an object of them.
function varNames(root: string, file: string): string[] {
  const content = text(join(root, file));
  if (file.endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(content);
      return typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : [];
    } catch {
      return [];
    }
  }
  return readHcl(content).attributes;
}

// The directory a local source names, from the repo root, or undefined for a
// source that is not a local path or leaves the repo. A Terragrunt source
// may be a plain relative path as well as one that starts with "./".
function localSource(from: string, source: string): string | undefined {
  if (/^[a-z+]+::|:\/\//i.test(source) || source.includes("//")) return undefined;
  if (!source.startsWith(".")) return undefined;
  const target = posix.normalize(posix.join(from, source)).replace(/\/+$/, "") || ".";
  if (target === ".." || target.startsWith("../")) return undefined;
  return target;
}

function text(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
