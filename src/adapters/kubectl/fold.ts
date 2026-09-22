import { parse } from "yaml";
import type { Change, Op } from "../../core/diff.ts";
import { changedPaths } from "../opentofu/paths.ts";
import type { ObjectPair } from "./unified.ts";

// From the two sides of each object to what a change says (records 0007 and
// 0060), settled from the recordings of both kubectl versions:
//
// - Nothing live, an object merged: create. Creates list no keys.
// - Both: update, with the paths that differ. An object whose only
//   differences are fields the server keeps for itself is no change.
// - Live, nothing merged: delete. kubectl prints this only with --prune, which
//   the adapter never passes, so no recording holds one.
//
// There is no replace: a change the API server cannot make in place, such as
// a Deployment's selector, fails the server-side dry run, and so the preview.

// Fields the server writes and a deploy never sets. The dry run moves some of
// them (a Deployment's generation goes up with every change of its spec), so
// they would make every update noisy and change nothing a person decides on.
const SERVER_FIELDS = [
  "generation",
  "resourceVersion",
  "uid",
  "creationTimestamp",
  "managedFields",
  "selfLink",
];

export type Folded =
  | { ok: true; changes: Change[] }
  // The detail names a place in the tool's output and what was expected
  // there, never what was found (record 0021).
  | { ok: false; reason: "unreadable-output"; detail: string[] };

interface Identity {
  address: string;
  type: string;
  name: string;
  secret: boolean;
}

export function foldObjects(pairs: ObjectPair[], showValues: readonly string[]): Folded {
  const changes: Change[] = [];
  const problems: string[] = [];
  const firstAt = new Map<string, number>();

  pairs.forEach((pair, index) => {
    const at = `The tool's output, at object ${index + 1}`;
    const live = yamlObject(pair.live);
    const merged = yamlObject(pair.merged);
    if (live === "unreadable" || merged === "unreadable") {
      problems.push(`${at}: expected one YAML object on each side.`);
      return;
    }
    const identity = identityOf(merged ?? live);
    if (identity === undefined) {
      problems.push(`${at}: expected an object with apiVersion, kind and metadata.name.`);
      return;
    }
    const earlier = firstAt.get(identity.address);
    if (earlier !== undefined) {
      problems.push(
        `${at}: expected an object that no earlier object is, and object ${earlier} is.`,
      );
      return;
    }
    firstAt.set(identity.address, index + 1);

    const op: Op = live === undefined ? "create" : merged === undefined ? "delete" : "update";
    const base = { address: identity.address, type: identity.type, name: identity.name, op };
    if (live === undefined || merged === undefined) {
      changes.push({ ...base, changedKeys: [], replaceKeys: [] });
      return;
    }
    // A Secret's data is masked by kubectl already, and its keys are held
    // like its values: the path stops at data (record 0053's rule for a
    // sensitive map).
    const sensitive = identity.secret ? { data: true, stringData: true } : undefined;
    const { paths, values } = changedPaths(
      {
        before: withoutServerFields(live),
        after: withoutServerFields(merged),
        afterUnknown: undefined,
        beforeSensitive: sensitive,
        afterSensitive: sensitive,
      },
      showValues,
    );
    const changedKeys = [...new Set(paths)].sort(byCodeUnit);
    if (changedKeys.length === 0) return;
    const shown = values.sort((a, b) => byCodeUnit(a.path, b.path));
    changes.push({
      ...base,
      changedKeys,
      replaceKeys: [],
      ...(shown.length === 0 ? {} : { values: shown }),
    });
  });

  if (problems.length > 0) return { ok: false, reason: "unreadable-output", detail: problems };
  changes.sort((a, b) => byCodeUnit(a.address, b.address));
  return { ok: true, changes };
}

// An empty side is no object, and so is `null`: kubectl's masking of a
// Secret prints the side of a Secret that does not exist yet that way (the
// recording new-stack). Anything but one mapping cannot be read.
function yamlObject(text: string): Record<string, unknown> | undefined | "unreadable" {
  if (text.trim() === "") return undefined;
  try {
    const parsed: unknown = parse(text);
    if (parsed === null) return undefined;
    return isObject(parsed) ? parsed : "unreadable";
  } catch {
    return "unreadable";
  }
}

// The address is the kind, with its API group when it has one, the
// namespace and the name, as in `Deployment.apps/shop/web`. Kubernetes names
// hold no "/", so it is unique. What a person sees is the kind and
// `namespace/name`.
function identityOf(object: Record<string, unknown> | undefined): Identity | undefined {
  if (object === undefined) return undefined;
  const { apiVersion, kind, metadata } = object;
  if (typeof apiVersion !== "string" || typeof kind !== "string" || kind === "") return undefined;
  if (!isObject(metadata) || typeof metadata.name !== "string" || metadata.name === "") {
    return undefined;
  }
  const slash = apiVersion.indexOf("/");
  const group = slash < 0 ? "" : apiVersion.slice(0, slash);
  const namespace = typeof metadata.namespace === "string" ? metadata.namespace : "";
  const name = namespace === "" ? metadata.name : `${namespace}/${metadata.name}`;
  const qualified = group === "" ? kind : `${kind}.${group}`;
  return {
    address: `${qualified}/${name}`,
    type: kind,
    name,
    secret: group === "" && kind === "Secret",
  };
}

function withoutServerFields(object: Record<string, unknown>): Record<string, unknown> {
  const { status: _status, metadata, ...rest } = object;
  if (!isObject(metadata)) return rest;
  const kept = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !SERVER_FIELDS.includes(key)),
  );
  return { ...rest, metadata: kept };
}

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
