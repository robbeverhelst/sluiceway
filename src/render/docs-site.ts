// The docs site, where every link Sluiceway writes for a reader goes (slice
// 5.19). The site follows the releases and has no page per version, so a link
// names the page and never a version. What has no page there, the project
// itself and the files a tool reads, stays a link into the repo.
export const DOCS_SITE = "https://docs.sluiceway.dev";

export const DOCS = {
  home: `${DOCS_SITE}/`,
  configuration: `${DOCS_SITE}/guides/configuration/`,
  credentials: `${DOCS_SITE}/guides/credentials/#recipes`,
  credentialsHelm: `${DOCS_SITE}/guides/credentials/#helm`,
  credentialsKubectl: `${DOCS_SITE}/guides/credentials/#kubernetes-manifests`,
  init: `${DOCS_SITE}/guides/init/`,
  workflow: `${DOCS_SITE}/guides/workflow/`,
  exampleWorkflows: `${DOCS_SITE}/guides/example-workflows/#what-to-change`,
  pinACommit: `${DOCS_SITE}/guides/workflow/#pin-a-commit`,
  splitWorkflow: `${DOCS_SITE}/guides/split-workflow/`,
} as const;
