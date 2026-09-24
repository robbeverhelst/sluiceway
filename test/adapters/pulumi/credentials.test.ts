import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { credentialNeeds } from "../../../src/adapters/pulumi/credentials.ts";
import { cloudWays } from "../../../src/core/credentials.ts";
import type { Stack } from "../../../src/core/stack.ts";

// Slice 5.34, record 0099: what a Pulumi stack's own files say its tool will
// want from the job environment. Read from the files alone, like discovery:
// the project file, the stack file, and the file that names the program's
// packages. Names only: no config value, no URL, no salt leaves this.

type Files = Record<string, string>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-pulumi-credentials-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const stack = (path: string, name?: string): Stack => ({
  path,
  ...(name === undefined ? {} : { name }),
  options: {},
});

const YAML_PROJECT = "name: network\nruntime: yaml\n";

const BACKEND_EITHER = {
  what: "the Pulumi backend",
  namedIn: "network/Pulumi.yaml",
  ways: [{ names: ["PULUMI_ACCESS_TOKEN"] }, { names: ["PULUMI_BACKEND_URL"] }],
};

describe("the backend and the secrets of a Pulumi stack", () => {
  test("a project with no backend needs a token for Pulumi Cloud or a backend URL", async () => {
    const root = repo({ "network/Pulumi.yaml": YAML_PROJECT, "network/Pulumi.prod.yaml": "" });
    expect(await credentialNeeds(root, stack("network", "prod"))).toEqual([BACKEND_EITHER]);
  });

  test("a stack file with an encryption salt needs the passphrase", async () => {
    const root = repo({
      "network/Pulumi.yaml": YAML_PROJECT,
      "network/Pulumi.prod.yaml":
        "encryptionsalt: v1:CANARY-SALT\nconfig:\n  network:zone: CANARY-VALUE\n",
    });
    const needs = await credentialNeeds(root, stack("network", "prod"));
    expect(needs).toEqual([
      BACKEND_EITHER,
      {
        what: "the passphrase of its secrets",
        namedIn: "network/Pulumi.prod.yaml",
        ways: [
          { names: ["PULUMI_CONFIG_PASSPHRASE"] },
          { names: ["PULUMI_CONFIG_PASSPHRASE_FILE"] },
        ],
      },
    ]);
    expect(JSON.stringify(needs)).not.toContain("CANARY");
  });

  test("a backend URL in the project names its cloud, and a file backend nothing", async () => {
    const s3 = repo({
      "network/Pulumi.yaml":
        "name: network\nruntime: yaml\nbackend:\n  url: s3://my-state-bucket?region=eu-west-1\n",
      "network/Pulumi.prod.yaml": "",
    });
    const needs = await credentialNeeds(s3, stack("network", "prod"));
    expect(needs).toEqual([
      { what: "the s3 backend", namedIn: "network/Pulumi.yaml", ways: cloudWays("aws") },
    ]);
    expect(JSON.stringify(needs)).not.toContain("my-state-bucket");
    const file = repo({
      "network/Pulumi.yaml": "name: network\nruntime: yaml\nbackend:\n  url: file://~\n",
      "network/Pulumi.prod.yaml": "",
    });
    expect(await credentialNeeds(file, stack("network", "prod"))).toEqual([]);
    const cloud = repo({
      "network/Pulumi.yaml":
        "name: network\nruntime: yaml\nbackend:\n  url: https://api.pulumi.com\n",
      "network/Pulumi.prod.yaml": "",
    });
    expect(await credentialNeeds(cloud, stack("network", "prod"))).toEqual([
      {
        what: "the Pulumi Cloud backend",
        namedIn: "network/Pulumi.yaml",
        ways: [{ names: ["PULUMI_ACCESS_TOKEN"] }],
      },
    ]);
  });

  test("a secrets provider of a cloud key service names that cloud", async () => {
    const root = repo({
      "network/Pulumi.yaml": YAML_PROJECT,
      "network/Pulumi.prod.yaml":
        "secretsprovider: gcpkms://projects/p/locations/l/keyRings/r/cryptoKeys/k\n",
    });
    const needs = await credentialNeeds(root, stack("network", "prod"));
    expect(needs).toEqual([
      BACKEND_EITHER,
      {
        what: "the gcpkms secrets provider",
        namedIn: "network/Pulumi.prod.yaml",
        ways: cloudWays("google"),
      },
    ]);
    expect(JSON.stringify(needs)).not.toContain("keyRings");
  });
});

describe("the providers of a Pulumi program", () => {
  test("a YAML program names its providers in its resource types, and one that needs nothing is left out", async () => {
    const root = repo({
      "network/Pulumi.yaml": `${YAML_PROJECT}resources:\n  pet:\n    type: random:RandomPet\n  bucket:\n    type: aws:s3:Bucket\n  ns:\n    type: kubernetes:core/v1:Namespace\n  again:\n    type: aws:ec2:Vpc\n`,
      "network/Pulumi.prod.yaml": "",
    });
    const needs = await credentialNeeds(root, stack("network", "prod"));
    expect(needs.slice(1)).toEqual([
      { what: "the aws provider", namedIn: "network/Pulumi.yaml", ways: cloudWays("aws") },
      {
        what: "a region for the aws provider",
        namedIn: "network/Pulumi.yaml",
        ways: [
          { names: ["AWS_REGION"] },
          { names: ["AWS_DEFAULT_REGION"] },
          { names: [], uses: "aws-actions/configure-aws-credentials" },
        ],
      },
      {
        what: "the kubernetes provider",
        namedIn: "network/Pulumi.yaml",
        ways: cloudWays("kubernetes"),
      },
    ]);
  });

  test("a region in the stack's config meets the region, and a config namespace names a provider", async () => {
    const root = repo({
      "network/Pulumi.yaml": YAML_PROJECT,
      "network/Pulumi.prod.yaml": "config:\n  aws:region: eu-west-1\n  network:zone: a\n",
    });
    const needs = await credentialNeeds(root, stack("network", "prod"));
    expect(needs.slice(1)).toEqual([
      { what: "the aws provider", namedIn: "network/Pulumi.prod.yaml", ways: cloudWays("aws") },
    ]);
    expect(JSON.stringify(needs)).not.toContain("eu-west-1");
  });

  test("a Node program names its providers in its package.json", async () => {
    const root = repo({
      "site/Pulumi.yaml": "name: site\nruntime: nodejs\n",
      "site/Pulumi.prod.yaml": "",
      "site/package.json": JSON.stringify({
        dependencies: { "@pulumi/pulumi": "3", "@pulumi/cloudflare": "5", "@pulumi/random": "4" },
        devDependencies: { "@pulumi/docker": "4" },
      }),
    });
    expect((await credentialNeeds(root, stack("site", "prod"))).slice(1)).toEqual([
      {
        what: "the cloudflare provider",
        namedIn: "site/package.json",
        ways: cloudWays("cloudflare"),
      },
      { what: "the docker provider", namedIn: "site/package.json", ways: [] },
    ]);
  });

  test("a Node program in a monorepo reads the nearest package.json above it", async () => {
    const root = repo({
      "package.json": JSON.stringify({ dependencies: { "@pulumi/hcloud": "1" } }),
      "infra/site/Pulumi.yaml": "name: site\nruntime: nodejs\n",
      "infra/site/Pulumi.prod.yaml": "",
    });
    expect((await credentialNeeds(root, stack("infra/site", "prod"))).slice(1)).toEqual([
      { what: "the hcloud provider", namedIn: "package.json", ways: cloudWays("hcloud") },
    ]);
  });

  test("a Python program names them in requirements.txt or pyproject.toml", async () => {
    const root = repo({
      "py/Pulumi.yaml": "name: py\nruntime: python\n",
      "py/Pulumi.prod.yaml": "",
      "py/requirements.txt": "pulumi>=3\npulumi-digitalocean==4.2.0\npulumi_random\n",
    });
    expect((await credentialNeeds(root, stack("py", "prod"))).slice(1)).toEqual([
      {
        what: "the digitalocean provider",
        namedIn: "py/requirements.txt",
        ways: cloudWays("digitalocean"),
      },
    ]);
    const project = repo({
      "py/Pulumi.yaml": "name: py\nruntime: python\n",
      "py/Pulumi.prod.yaml": "",
      "py/pyproject.toml": '[project]\ndependencies = ["pulumi>=3", "pulumi-linode>=4"]\n',
    });
    expect((await credentialNeeds(project, stack("py", "prod"))).slice(1)).toEqual([
      { what: "the linode provider", namedIn: "py/pyproject.toml", ways: cloudWays("linode") },
    ]);
  });

  test("a Go program names them in go.mod, and a .NET program in its project file", async () => {
    const go = repo({
      "go/Pulumi.yaml": "name: go\nruntime: go\n",
      "go/Pulumi.prod.yaml": "",
      "go/go.mod":
        "module x\n\nrequire (\n\tgithub.com/pulumi/pulumi-azure-native-sdk/v2 v2.1.0\n\tgithub.com/pulumi/pulumi/sdk/v3 v3.1.0\n\tgithub.com/pulumi/pulumi-vault/sdk/v6 v6.0.0\n)\n",
    });
    expect((await credentialNeeds(go, stack("go", "prod"))).slice(1)).toEqual([
      { what: "the azure-native provider", namedIn: "go/go.mod", ways: cloudWays("azure") },
      { what: "the vault provider", namedIn: "go/go.mod", ways: cloudWays("vault") },
    ]);
    const dotnet = repo({
      "net/Pulumi.yaml": "name: net\nruntime: dotnet\n",
      "net/Pulumi.prod.yaml": "",
      "net/net.csproj":
        '<Project>\n  <PackageReference Include="Pulumi" Version="3" />\n  <PackageReference Include="Pulumi.Gcp" Version="8" />\n</Project>\n',
    });
    expect((await credentialNeeds(dotnet, stack("net", "prod"))).slice(1)).toEqual([
      { what: "the gcp provider", namedIn: "net/net.csproj", ways: cloudWays("google") },
    ]);
  });

  test("a program the check cannot read the packages of names no provider", async () => {
    const root = repo({
      "j/Pulumi.yaml": "name: j\nruntime: java\n",
      "j/Pulumi.prod.yaml": "",
    });
    expect(await credentialNeeds(root, stack("j", "prod"))).toEqual([
      { ...BACKEND_EITHER, namedIn: "j/Pulumi.yaml" },
    ]);
  });
});
