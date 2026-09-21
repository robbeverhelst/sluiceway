import { describe, expect, test } from "bun:test";
import {
  isPerson,
  judgeTick,
  type Permission,
  type TickVerdict,
} from "../../src/core/tick-rule.ts";

// What GitHub answers for each kind of person, as the lab and a probe of the
// real endpoint saw it: the three booleans of `user.permissions`.
const NONE: Permission = { push: false, maintain: false, admin: false };
const WRITE: Permission = { push: true, maintain: false, admin: false };
const MAINTAIN: Permission = { push: true, maintain: true, admin: false };
const ADMIN: Permission = { push: true, maintain: true, admin: true };

const ALLOWED: TickVerdict = { allowed: true };

describe("a level", () => {
  test("write is met by anyone who can push", () => {
    expect(judgeTick("write", "alice", WRITE)).toEqual(ALLOWED);
    expect(judgeTick("write", "alice", MAINTAIN)).toEqual(ALLOWED);
    expect(judgeTick("write", "alice", ADMIN)).toEqual(ALLOWED);
  });

  test("maintain is met by a maintainer and by an admin, not by write access", () => {
    expect(judgeTick("maintain", "alice", MAINTAIN)).toEqual(ALLOWED);
    expect(judgeTick("maintain", "alice", ADMIN)).toEqual(ALLOWED);
    expect(judgeTick("maintain", "alice", WRITE)).toEqual({
      allowed: false,
      reason: "below-level",
    });
  });

  test("admin is met by an admin alone", () => {
    expect(judgeTick("admin", "alice", ADMIN)).toEqual(ALLOWED);
    expect(judgeTick("admin", "alice", MAINTAIN)).toEqual({
      allowed: false,
      reason: "below-level",
    });
    expect(judgeTick("admin", "alice", WRITE)).toEqual({ allowed: false, reason: "below-level" });
  });

  test("someone who cannot push has no write access, whatever the level", () => {
    for (const level of ["write", "maintain", "admin"] as const) {
      expect(judgeTick(level, "alice", NONE)).toEqual({
        allowed: false,
        reason: "no-write-access",
      });
    }
  });

  test("a level's boolean without push is still no write access", () => {
    // GitHub never answers this. The write check stands on its own anyway.
    expect(judgeTick("admin", "alice", { push: false, maintain: true, admin: true })).toEqual({
      allowed: false,
      reason: "no-write-access",
    });
  });
});

describe("a list of usernames", () => {
  test("lets a named person with write access tick", () => {
    expect(judgeTick(["alice", "bob"], "bob", WRITE)).toEqual(ALLOWED);
  });

  test("does not widen: a named person without write access is refused", () => {
    expect(judgeTick(["alice"], "alice", NONE)).toEqual({
      allowed: false,
      reason: "no-write-access",
    });
  });

  test("narrows: an admin who is not named is refused", () => {
    expect(judgeTick(["alice"], "carol", ADMIN)).toEqual({
      allowed: false,
      reason: "not-on-list",
    });
  });

  test("compares the login without regard to case", () => {
    // Config loading keeps the list in lower case. GitHub gives the login as
    // the person wrote it.
    expect(judgeTick(["alice"], "Alice", WRITE)).toEqual(ALLOWED);
  });

  test("a login that only starts like a named one is not on the list", () => {
    expect(judgeTick(["alice"], "alice2", WRITE)).toEqual({
      allowed: false,
      reason: "not-on-list",
    });
  });
});

describe("only a person can tick", () => {
  test("a user is a person", () => {
    expect(isPerson({ login: "alice", type: "User" })).toBe(true);
  });

  test("the bot is not", () => {
    expect(isPerson({ login: "github-actions[bot]", type: "Bot" })).toBe(false);
  });

  test("no other type is, and neither is an editor GitHub no longer names", () => {
    for (const type of ["Organization", "Mannequin", "EnterpriseUserAccount", "user", ""]) {
      expect(isPerson({ login: "alice", type })).toBe(false);
    }
    expect(isPerson({ login: "", type: "User" })).toBe(false);
  });

  test("ghost is not, in any case of the letters", () => {
    expect(isPerson({ login: "ghost", type: "User" })).toBe(false);
    expect(isPerson({ login: "Ghost", type: "User" })).toBe(false);
  });
});
