// What each stack needs from the job environment, and what the workflow
// hands it (record 0099). The check says both, names only: a variable name,
// a login action, a command. No value is ever read, not from a file and not
// from the environment of the process. Sluiceway still never reads a
// credential variable (record 0014): what is read here is the workflow file
// as text, and an env file of the repo for its names.
//
// Every answer is a reading of the files, never a guarantee: a program can
// read any variable, and a step that writes to the environment or loads an
// env file the check cannot read is opaque. So a need nothing names is said
// as "nothing in this workflow provides", and never as a failure.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobProvides } from "./workflow-check.ts";

// One way a need can reach the tool: variable names that go together, a
// login action before the Sluiceway step (`uses: owner/repo`), or a command
// a run step before it holds, such as one that writes a kubeconfig.
export interface CredentialWay {
  names: string[];
  uses?: string;
  runs?: string;
}

// One thing a stack's own files say its tool will want, and the ways that
// give it, any one of which is enough. Empty ways: the check has no table for
// it, and says so rather than guess.
export interface CredentialNeed {
  // "the aws provider", "the Pulumi backend", "the cluster".
  what: string;
  // The file of the repo that names it.
  namedIn: string;
  ways: CredentialWay[];
}

// The clouds and services the table knows, by the name the adapters map a
// provider or a backend to.
export const CLOUDS = [
  "aws",
  "google",
  "azure",
  "kubernetes",
  "cloudflare",
  "digitalocean",
  "github",
  "hcloud",
  "linode",
  "vault",
  "vultr",
] as const;
export type Cloud = (typeof CLOUDS)[number];

// The official login actions the docs name (docs/credentials.md), and the
// commands that write a kubeconfig. A fixed table, so the answer is the same
// for everyone, and a value is never needed to give it.
const WAYS: Record<Cloud, CredentialWay[]> = {
  aws: [
    { names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] },
    { names: ["AWS_PROFILE"] },
    { names: [], uses: "aws-actions/configure-aws-credentials" },
  ],
  google: [
    { names: ["GOOGLE_APPLICATION_CREDENTIALS"] },
    { names: ["GOOGLE_CREDENTIALS"] },
    { names: ["GOOGLE_OAUTH_ACCESS_TOKEN"] },
    { names: [], uses: "google-github-actions/auth" },
  ],
  azure: [
    { names: ["ARM_CLIENT_ID", "ARM_TENANT_ID", "ARM_SUBSCRIPTION_ID", "ARM_CLIENT_SECRET"] },
    { names: ["ARM_CLIENT_ID", "ARM_TENANT_ID", "ARM_SUBSCRIPTION_ID", "ARM_USE_OIDC"] },
    { names: [], uses: "azure/login" },
  ],
  kubernetes: [
    { names: ["KUBECONFIG"] },
    { names: [], runs: "update-kubeconfig" },
    { names: [], runs: "get-credentials" },
    { names: [], uses: "azure/aks-set-context" },
    { names: [], uses: "google-github-actions/get-gke-credentials" },
  ],
  cloudflare: [
    { names: ["CLOUDFLARE_API_TOKEN"] },
    { names: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"] },
  ],
  digitalocean: [{ names: ["DIGITALOCEAN_TOKEN"] }],
  github: [{ names: ["GITHUB_TOKEN"] }],
  hcloud: [{ names: ["HCLOUD_TOKEN"] }],
  linode: [{ names: ["LINODE_TOKEN"] }],
  vault: [{ names: ["VAULT_ADDR", "VAULT_TOKEN"] }],
  vultr: [{ names: ["VULTR_API_KEY"] }],
};

export function cloudWays(cloud: Cloud): CredentialWay[] {
  return WAYS[cloud].map((way) => ({ ...way, names: [...way.names] }));
}

// A setting a provider refuses to run without and that is not a credential:
// the region of the aws provider, which the login action sets too. Undefined
// for a cloud whose provider needs none from the environment.
export function regionWays(cloud: Cloud): CredentialWay[] | undefined {
  if (cloud !== "aws") return undefined;
  return [
    { names: ["AWS_REGION"] },
    { names: ["AWS_DEFAULT_REGION"] },
    { names: [], uses: "aws-actions/configure-aws-credentials" },
  ];
}

export function isCloud(name: string): name is Cloud {
  return (CLOUDS as readonly string[]).includes(name);
}

// A way, as the check writes it.
export function wayWords(way: CredentialWay): string {
  if (way.names.length > 0) return way.names.join(" with ");
  if (way.uses !== undefined) return `a step that uses ${way.uses}`;
  return `a step that runs ${way.runs ?? ""}`;
}

// Actions that load secrets into the job by names the check does not read
// (docs/credentials.md). A step that uses one is opaque to the check.
const LOADERS = new Set([
  "hashicorp/vault-action",
  "dopplerhq/secrets-fetch-action",
  "aws-actions/aws-secretsmanager-get-secrets",
  "google-github-actions/get-secretmanager-secrets",
  "1password/load-secrets-action",
]);

// A file that looks like an env file, by its name (the rule init uses).
const ENV_FILE = /(^|\/)(\.env(\.[^/]+)?|[^/]+\.env)$/;
const ENV_LINE = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// What one job hands the tool, read from the workflow file and the env files
// of the repo its run steps name.
export interface JobEnvironment {
  // Variable name to where the file sets it, in the order found.
  names: Map<string, string>;
  // The actions of the steps before the Sluiceway step.
  uses: string[];
  // The text of every run step before it.
  runs: string[];
  // The steps before it whose effect on the environment the check cannot
  // see: a run step that writes to GITHUB_ENV or loads an env file it cannot
  // read, a step that is handed a secret, a secret loader action.
  opaque: string[];
}

export function jobEnvironment(provides: JobProvides, root: string): JobEnvironment {
  const names = new Map<string, string>();
  for (const { name, where } of provides.names) if (!names.has(name)) names.set(name, where);
  const uses: string[] = [];
  const runs: string[] = [];
  const opaque: string[] = [];
  for (const step of provides.steps) {
    if (!step.before) continue;
    let seen = step.secret === true;
    if (step.uses !== undefined) {
      uses.push(step.uses);
      if (LOADERS.has(step.uses)) seen = true;
    }
    if (step.run !== undefined) {
      runs.push(step.run);
      if (step.run.includes("GITHUB_ENV")) seen = true;
      for (const file of envFilesNamed(step.run)) {
        const listed = envFileNames(root, file);
        if (listed === undefined) {
          seen = true;
          continue;
        }
        for (const name of listed) if (!names.has(name)) names.set(name, `listed in ${file}`);
      }
    }
    if (seen && !opaque.includes(step.step)) opaque.push(step.step);
  }
  return { names, uses, runs, opaque };
}

// The paths in a run step's text that look like env files, each once.
function envFilesNamed(text: string): string[] {
  const found: string[] = [];
  for (const token of text.split(/[\s=]+/)) {
    const path = token.replace(/^["']|["']$/g, "");
    if (/^[\w./-]+$/.test(path) && ENV_FILE.test(path) && !found.includes(path)) found.push(path);
  }
  return found;
}

// The variable names an env file of the repo lists, or undefined when there
// is no such file. Only the name before `=` is read.
export function envFileNames(root: string, file: string): string[] | undefined {
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    return undefined;
  }
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const name = ENV_LINE.exec(line)?.[2];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

export type JudgedNeed = { need: CredentialNeed } & (
  | { met: true; by: string }
  | { met: false; maybe: string[] }
  | { met: "unknown" }
);

// Each need against what the job hands the tool: met by the first way the
// file shows, a maybe when a step the check cannot see into runs before the
// Sluiceway step, unknown when the table has no way for it.
export function judgeNeeds(needs: CredentialNeed[], job: JobEnvironment): JudgedNeed[] {
  return needs.map((need) => {
    if (need.ways.length === 0) return { need, met: "unknown" };
    for (const way of need.ways) {
      const by = meets(way, job);
      if (by !== undefined) return { need, met: true, by };
    }
    return { need, met: false, maybe: [...job.opaque] };
  });
}

function meets(way: CredentialWay, job: JobEnvironment): string | undefined {
  if (way.names.length > 0) {
    const wheres = way.names.map((name) => job.names.get(name));
    if (wheres.some((where) => where === undefined)) return undefined;
    const where = [...new Set(wheres)].join(" and ");
    return `${wayWords(way)}, ${where}`;
  }
  if (way.uses !== undefined) return job.uses.includes(way.uses) ? wayWords(way) : undefined;
  if (way.runs !== undefined) {
    const word = way.runs;
    return job.runs.some((run) => run.includes(word)) ? wayWords(way) : undefined;
  }
  return undefined;
}

// The needs of every stack, by stack id, in stack id order.
export interface StackNeeds {
  stackId: string;
  needs: CredentialNeed[];
}

// One job that runs the tool, and every need judged against what it hands
// the step.
export interface JobCredentials {
  path: string;
  job: string;
  judged: (JudgedNeed & { stackId: string })[];
}

// Every job whose modes run the tool (scan or apply, record 0014), with the
// needs of every stack judged against what the file shows it hands the step.
export function judgeJobs(
  stacks: StackNeeds[],
  workflows: { path: string; jobs: { job: string; runs: string[]; provides: JobProvides }[] }[],
  root: string,
): JobCredentials[] {
  return workflows.flatMap(({ path, jobs }) =>
    jobs
      .filter(({ runs }) => runs.includes("scan") || runs.includes("apply"))
      .map(({ job, provides }) => {
        const environment = jobEnvironment(provides, root);
        return {
          path,
          job,
          judged: stacks.flatMap(({ stackId, needs }) =>
            judgeNeeds(needs, environment).map((one) => ({ ...one, stackId })),
          ),
        };
      }),
  );
}
