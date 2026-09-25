import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  type ConfigIssue,
  DASHBOARD_SECTIONS,
  parseConfig,
} from "../../src/core/config.ts";
import { configProblemText } from "../../src/render/config-problems.ts";

// Slice 5.51 (record 0114): the dashboard layout keys. Every key is optional
// and its default is the dashboard as it was before them, so no dashboard
// moves on upgrade.

function issues(text: string): ConfigIssue[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

describe("the defaults", () => {
  test("no file gives the layout of today", () => {
    const { dashboard } = parseConfig(undefined);
    expect({
      sections: dashboard.sections,
      deployingSection: dashboard.deployingSection,
      driftedSection: dashboard.driftedSection,
      inSyncSection: dashboard.inSyncSection,
      zeroCounts: dashboard.zeroCounts,
      destroyAlert: dashboard.destroyAlert,
      pendingDetail: dashboard.pendingDetail,
      deployAll: dashboard.deployAll,
      repairAll: dashboard.repairAll,
      rescanBox: dashboard.rescanBox,
      footer: dashboard.footer,
    }).toEqual({
      // Record 0063's order.
      sections: [
        "deploying",
        "updates",
        "pending",
        "drifted",
        "previewFailed",
        "inSync",
        "recentlyDeployed",
      ],
      deployingSection: true,
      driftedSection: true,
      inSyncSection: "fold",
      zeroCounts: true,
      destroyAlert: "destroys",
      pendingDetail: "full",
      deployAll: true,
      repairAll: true,
      rescanBox: true,
      footer: true,
    });
    expect(dashboard.sections).toEqual([...DASHBOARD_SECTIONS]);
  });
});

describe("dashboard.sections", () => {
  // The body puts a section the list leaves out after the ones it names, in
  // today's order (test/render/dashboard-layout.test.ts), so a list written
  // before a section existed still loads and still shows it.
  test("the list is kept as written, and may leave sections out", () => {
    expect(
      parseConfig("dashboard:\n  sections: [pending, previewFailed]\n").dashboard.sections,
    ).toEqual(["pending", "previewFailed"]);
    expect(parseConfig("dashboard:\n  sections: []\n").dashboard.sections).toEqual([]);
  });

  test("a name that is not a section, and a section named twice, fail with words", () => {
    const wrong = issues("dashboard:\n  sections: [pending, failed]\n");
    expect(wrong).toEqual([
      {
        kind: "not-one-of",
        value: "failed",
        choices: DASHBOARD_SECTIONS,
        path: ["dashboard", "sections", 1],
      },
    ]);
    expect(configProblemText(wrong[0] as ConfigIssue)).toBe(
      'dashboard.sections[1]: expected one of "deploying", "updates", "pending", "drifted", "previewFailed", "inSync", "recentlyDeployed", got "failed".',
    );
    const twice = issues("dashboard:\n  sections: [pending, inSync, pending]\n");
    expect(twice).toEqual([
      {
        kind: "section-named-twice",
        section: "pending",
        first: 0,
        path: ["dashboard", "sections", 2],
      },
    ]);
    expect(configProblemText(twice[0] as ConfigIssue)).toBe(
      'dashboard.sections[2]: "pending" is already dashboard.sections[0]. Name each section once.',
    );
  });
});

describe("the switches", () => {
  test("each takes its words, and nothing else", () => {
    const dashboard = parseConfig(
      [
        "dashboard:",
        "  deployingSection: false",
        "  driftedSection: false",
        "  inSyncSection: list",
        "  zeroCounts: false",
        "  destroyAlert: always",
        "  pendingDetail: names",
        "  deployAll: false",
        "  repairAll: false",
        "  rescanBox: false",
        "  footer: false",
        "",
      ].join("\n"),
    ).dashboard;
    expect(dashboard).toMatchObject({
      deployingSection: false,
      driftedSection: false,
      inSyncSection: "list",
      zeroCounts: false,
      destroyAlert: "always",
      pendingDetail: "names",
      deployAll: false,
      repairAll: false,
      rescanBox: false,
      footer: false,
    });
    expect(parseConfig("dashboard:\n  inSyncSection: off\n").dashboard.inSyncSection).toBe("off");
    expect(parseConfig("dashboard:\n  pendingDetail: compact\n").dashboard.pendingDetail).toBe(
      "compact",
    );
  });

  test("the destroy alert has no off, and a word a key does not take is named", () => {
    expect(issues("dashboard:\n  destroyAlert: never\n")).toEqual([
      {
        kind: "not-one-of",
        value: "never",
        choices: ["destroys", "always"],
        path: ["dashboard", "destroyAlert"],
      },
    ]);
    expect(issues("dashboard:\n  pendingDetail: short\n")).toEqual([
      {
        kind: "not-one-of",
        value: "short",
        choices: ["full", "compact", "names"],
        path: ["dashboard", "pendingDetail"],
      },
    ]);
    expect(issues("dashboard:\n  inSyncSection: false\n")).toEqual([
      {
        kind: "not-one-of",
        value: false,
        choices: ["fold", "list", "off"],
        path: ["dashboard", "inSyncSection"],
      },
    ]);
    expect(issues('dashboard:\n  footer: "no"\n')).toEqual([
      { kind: "wrong-type", expected: "boolean", value: "no", path: ["dashboard", "footer"] },
    ]);
  });

  // Pending and Preview failed are what a person must see (issue 277), so
  // there is no key to turn either off.
  test("Pending and Preview failed have no switch", () => {
    for (const key of ["pendingSection", "previewFailedSection"]) {
      expect(issues(`dashboard:\n  ${key}: false\n`)[0]).toMatchObject({
        kind: "unknown-key",
        key,
        path: ["dashboard"],
      });
    }
  });
});
