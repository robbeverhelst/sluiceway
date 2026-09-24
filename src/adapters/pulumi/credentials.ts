import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { parse } from "yaml";
import { type Cloud, type CredentialNeed, cloudWays, regionWays } from "../../core/credentials.ts";
import type { Stack } from "../../core/stack.ts";

// What a Pulumi stack's own files say the tool will want from the job
// environment (record 0099), for the check. Read from the files alone, like
// discovery: the tool never starts, and no value leaves this file. Only the
// name of a key, the scheme of a URL, and the name of a package are read.
//
// - The backend: the project's `backend.url` names its cloud by its scheme,
//   Pulumi Cloud needs the access token, and a project with no backend takes
//   the token or a backend URL from the environment.
// - The secrets: a stack file with an `encryptionsalt` uses a passphrase, and
//   a `secretsprovider` of a cloud key service needs that cloud.
// - The providers: the resource types of a YAML program, or the packages the
//   program's own manifest names, and the namespaces of the stack's config.

const EXTENSIONS = [".json", ".yaml", ".yml"];

// The Pulumi package of a provider, and the cloud its credentials come from.
// `nothing` is a provider that needs no credential. A package that is not
// here is a provider the check has no table for, and it says so.
const PACKAGES: Record<string, Cloud | "nothing"> = {
  aws: "aws",
  "aws-native": "aws",
  gcp: "google",
  "google-native": "google",
  azure: "azure",
  "azure-native": "azure",
  azuread: "azure",
  kubernetes: "kubernetes",
  cloudflare: "cloudflare",
  digitalocean: "digitalocean",
  github: "github",
  hcloud: "hcloud",
  linode: "linode",
  vault: "vault",
  vultr: "vultr",
  random: "nothing",
  command: "nothing",
  local: "nothing",
  null: "nothing",
  time: "nothing",
  tls: "nothing",
  std: "nothing",
  archive: "nothing",
  external: "nothing",
  http: "nothing",
  pulumi: "nothing",
};

// The scheme of a backend URL, and what it needs.
const BACKENDS: Record<string, Cloud | "nothing"> = {
  s3: "aws",
  gs: "google",
  azblob: "azure",
  file: "nothing",
};

// The scheme of a secrets provider, and the cloud its key lives in.
const SECRETS: Record<string, Cloud> = {
  awskms: "aws",
  gcpkms: "google",
  azurekeyvault: "azure",
  hashivault: "vault",
};

const TOKEN: CredentialNeed["ways"] = [{ names: ["PULUMI_ACCESS_TOKEN"] }];
const PASSPHRASE: CredentialNeed["ways"] = [
  { names: ["PULUMI_CONFIG_PASSPHRASE"] },
  { names: ["PULUMI_CONFIG_PASSPHRASE_FILE"] },
];

export async function credentialNeeds(root: string, stack: Stack): Promise<CredentialNeed[]> {
  const projectDir = join(root, stack.path);
  const extension = EXTENSIONS.find((ext) => isFile(join(projectDir, `Pulumi${ext}`)));
  if (extension === undefined) return [];
  const projectPath = join(projectDir, `Pulumi${extension}`);
  const project = read(projectPath);
  if (!isRecord(project)) return [];
  const projectFile = repoPath(root, projectPath);
  const needs: CredentialNeed[] = [];

  // The backend.
  const url = isRecord(project.backend) ? project.backend.url : undefined;
  const scheme = typeof url === "string" ? schemeOf(url) : undefined;
  if (scheme === undefined) {
    needs.push({
      what: "the Pulumi backend",
      namedIn: projectFile,
      ways: [{ names: ["PULUMI_ACCESS_TOKEN"] }, { names: ["PULUMI_BACKEND_URL"] }],
    });
  } else if (scheme === "https" || scheme === "http") {
    needs.push({ what: "the Pulumi Cloud backend", namedIn: projectFile, ways: TOKEN });
  } else {
    const cloud = BACKENDS[scheme];
    if (cloud !== "nothing") {
      needs.push({
        what: `the ${scheme} backend`,
        namedIn: projectFile,
        ways: cloud === undefined ? [] : cloudWays(cloud),
      });
    }
  }

  // The secrets of the stack file.
  const stackDir =
    typeof project.stackConfigDir === "string"
      ? join(projectDir, project.stackConfigDir)
      : projectDir;
  const stackPath =
    stack.name === undefined ? undefined : join(stackDir, `Pulumi.${stack.name}${extension}`);
  const stackFile = stackPath === undefined ? undefined : read(stackPath);
  const stackRepoPath = stackPath === undefined ? projectFile : repoPath(root, stackPath);
  if (isRecord(stackFile)) {
    const provider =
      typeof stackFile.secretsprovider === "string"
        ? schemeOf(stackFile.secretsprovider)
        : undefined;
    if ("encryptionsalt" in stackFile || provider === "passphrase") {
      needs.push({
        what: "the passphrase of its secrets",
        namedIn: stackRepoPath,
        ways: PASSPHRASE,
      });
    }
    if (provider !== undefined && provider !== "passphrase") {
      const cloud = SECRETS[provider];
      needs.push({
        what: `the ${provider} secrets provider`,
        namedIn: stackRepoPath,
        ways: cloud === undefined ? [] : cloudWays(cloud),
      });
    }
  }

  // The providers, each once, from the first file that names it.
  const providers = new Map<string, string>();
  const name = (provider: string, file: string) => {
    if (!providers.has(provider)) providers.set(provider, file);
  };
  const runtime = runtimeName(project.runtime);
  if (runtime === "yaml") {
    for (const provider of yamlProviders(projectDir, projectPath, project)) name(...provider);
  } else if (runtime === "nodejs") {
    for (const provider of nodeProviders(root, stack.path)) name(...provider);
  } else if (runtime === "python") {
    for (const provider of pythonProviders(projectDir)) name(...provider);
  } else if (runtime === "go") {
    for (const provider of goProviders(projectDir)) name(...provider);
  } else if (runtime === "dotnet") {
    for (const provider of dotnetProviders(projectDir)) name(...provider);
  }
  const configKeys = new Set<string>();
  for (const [file, config] of [
    [projectPath, project.config],
    [stackPath, isRecord(stackFile) ? stackFile.config : undefined],
  ] as const) {
    if (file === undefined || !isRecord(config)) continue;
    for (const key of Object.keys(config)) {
      configKeys.add(key);
      const namespace = key.split(":")[0] ?? "";
      if (key.includes(":") && namespace in PACKAGES) name(namespace, file);
    }
  }
  for (const [provider, file] of providers) {
    const cloud = PACKAGES[provider];
    if (cloud === "nothing") continue;
    const namedIn = repoPath(root, file);
    needs.push({
      what: `the ${provider} provider`,
      namedIn,
      ways: cloud === undefined ? [] : cloudWays(cloud),
    });
    const region = cloud === undefined ? undefined : regionWays(cloud);
    if (region !== undefined && !configKeys.has(`${provider}:region`)) {
      needs.push({ what: `a region for the ${provider} provider`, namedIn, ways: region });
    }
  }
  return needs;
}

type Named = [provider: string, file: string];

// The providers a YAML program's resource types name: `aws:s3:Bucket` is the
// aws provider, and so is `pulumi:providers:aws`.
function yamlProviders(projectDir: string, projectPath: string, project: unknown): Named[] {
  const programDir =
    isRecord(project) && typeof project.main === "string"
      ? join(projectDir, project.main)
      : projectDir;
  const programs =
    programDir === projectDir
      ? [projectPath, join(projectDir, "Main.yaml")]
      : [join(programDir, "Main.yaml"), join(programDir, "Pulumi.yaml")];
  const found: Named[] = [];
  for (const file of programs.filter(isFile)) {
    const program = file === projectPath ? project : read(file);
    walk(program, (key, value) => {
      if (key !== "type" || typeof value !== "string") return;
      const [first, second, third] = value.split(":");
      const provider = first === "pulumi" && second === "providers" ? third : first;
      if (provider !== undefined && provider !== "") found.push([provider, file]);
    });
  }
  return found;
}

// The `@pulumi/<name>` packages of the nearest package.json, in the project's
// directory or above it, inside the repo.
function nodeProviders(root: string, path: string): Named[] {
  for (const directory of ancestors(path)) {
    const file = join(root, directory, "package.json");
    if (!isFile(file)) continue;
    const manifest = readJson(file);
    if (!isRecord(manifest)) return [];
    return [manifest.dependencies, manifest.devDependencies].flatMap((block) =>
      isRecord(block)
        ? Object.keys(block).flatMap((key): Named[] =>
            key.startsWith("@pulumi/") ? [[key.slice("@pulumi/".length), file]] : [],
          )
        : [],
    );
  }
  return [];
}

const PYTHON_PACKAGE = /\bpulumi[-_]([a-z0-9-]+)/gi;

function pythonProviders(projectDir: string): Named[] {
  return ["requirements.txt", "pyproject.toml"].flatMap((name): Named[] => {
    const file = join(projectDir, name);
    if (!isFile(file)) return [];
    return [...text(file).matchAll(PYTHON_PACKAGE)].map((match) => [
      (match[1] ?? "").toLowerCase().replaceAll("_", "-"),
      file,
    ]);
  });
}

const GO_PACKAGE = /github\.com\/pulumi\/pulumi-([a-z0-9-]+?)(?:-sdk)?\/(?:sdk|v\d+)/g;

function goProviders(projectDir: string): Named[] {
  const file = join(projectDir, "go.mod");
  if (!isFile(file)) return [];
  return [...text(file).matchAll(GO_PACKAGE)].map((match) => [match[1] ?? "", file]);
}

const DOTNET_PACKAGE = /Include="Pulumi\.([A-Za-z0-9]+)"/g;

function dotnetProviders(projectDir: string): Named[] {
  let names: string[];
  try {
    names = readdirSync(projectDir).filter((name) => /\.(cs|fs|vb)proj$/.test(name));
  } catch {
    return [];
  }
  return names.sort().flatMap((name): Named[] => {
    const file = join(projectDir, name);
    return [...text(file).matchAll(DOTNET_PACKAGE)].map((match) => [kebab(match[1] ?? ""), file]);
  });
}

// `AzureNative` is the package `azure-native`.
function kebab(name: string): string {
  return name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, "-").toLowerCase();
}

function runtimeName(runtime: unknown): unknown {
  return isRecord(runtime) ? runtime.name : runtime;
}

// The scheme of a URL, or the whole word when it has none. Nothing else of
// the URL is read.
function schemeOf(url: string): string {
  const colon = url.indexOf("://");
  return (colon === -1 ? url : url.slice(0, colon)).toLowerCase();
}

// The path and every directory above it, nearest first, the root last.
function ancestors(path: string): string[] {
  const found = [path];
  let current = path;
  while (current !== ".") {
    current = posix.dirname(current);
    found.push(current);
  }
  return found;
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (isRecord(value)) {
    for (const [key, inner] of Object.entries(value)) {
      visit(key, inner);
      walk(inner, visit);
    }
  }
}

function read(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"), { uniqueKeys: false });
  } catch {
    return undefined;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function text(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
