import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CommandRun, fileStore, tokenStore } from "../../src/cli/token-store.ts";

// Slice 5.53 (record 0116): `sluiceway login` keeps the token in the
// operating system's keychain where there is one, and otherwise in a file
// only the person can read. The keychain's own command is the one process
// the command line starts, and the token never is one of its arguments.

const APP = "https://app.sluiceway.dev";
const OTHER = "http://127.0.0.1:4000";
const TOKEN = "sluiceway_AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKK";

function configDir(): string {
  return mkdtempSync(join(tmpdir(), "sluiceway-config-"));
}

// A keychain of the kind the command runs against, in memory.
function fakeKeychain(kind: "security" | "secret-tool") {
  const items = new Map<string, string>();
  const calls: { command: string; args: string[]; input: string | undefined }[] = [];
  const run: CommandRun = (command, args, input) => {
    calls.push({ command, args, input });
    if (command !== kind) return undefined;
    if (kind === "security") {
      if (args[0] === "-i") {
        const match = input?.match(/-a "([^"]+)" -s "sluiceway" .* -w "([^"]+)"/);
        if (match?.[1] !== undefined && match[2] !== undefined) items.set(match[1], match[2]);
        return { code: 0, stdout: "" };
      }
      const account = args[args.indexOf("-a") + 1] ?? "";
      if (args[0] === "find-generic-password") {
        const value = items.get(account);
        return value === undefined ? { code: 44, stdout: "" } : { code: 0, stdout: `${value}\n` };
      }
      if (args[0] === "delete-generic-password") {
        return { code: items.delete(account) ? 0 : 44, stdout: "" };
      }
    } else {
      const account = args[args.indexOf("app") + 1] ?? "";
      if (args[0] === "store") {
        items.set(account, input ?? "");
        return { code: 0, stdout: "" };
      }
      if (args[0] === "lookup") {
        const value = items.get(account);
        return value === undefined ? { code: 1, stdout: "" } : { code: 0, stdout: value };
      }
      if (args[0] === "clear") return { code: items.delete(account) ? 0 : 1, stdout: "" };
    }
    return { code: 1, stdout: "" };
  };
  return { items, calls, run };
}

const noCommands: CommandRun = () => undefined;

describe("the file, where no keychain is", () => {
  test("keeps one token per app address, readable by the person alone", async () => {
    const dir = configDir();
    const store = fileStore(dir);
    const where = await store.write(APP, TOKEN);
    await store.write(OTHER, "sluiceway_other");
    const file = join(dir, "sluiceway", "tokens.json");
    expect(where).toBe(file);
    expect(await store.read(APP)).toBe(TOKEN);
    expect(await store.read(OTHER)).toBe("sluiceway_other");
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "sluiceway")).mode & 0o777).toBe(0o700);
    }
  });

  test("a file that was there with a wider mode is narrowed on write", async () => {
    if (process.platform === "win32") return;
    const dir = configDir();
    const store = fileStore(dir);
    await store.write(APP, TOKEN);
    const file = join(dir, "sluiceway", "tokens.json");
    Bun.spawnSync(["chmod", "644", file]);
    await store.write(APP, TOKEN);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("remove takes the one app's token and leaves no empty file", async () => {
    const dir = configDir();
    const store = fileStore(dir);
    await store.write(APP, TOKEN);
    await store.write(OTHER, "sluiceway_other");
    expect(await store.remove(APP)).toBe(true);
    expect(await store.read(APP)).toBeUndefined();
    expect(await store.read(OTHER)).toBe("sluiceway_other");
    expect(await store.remove(OTHER)).toBe(true);
    expect(existsSync(join(dir, "sluiceway", "tokens.json"))).toBe(false);
    expect(await store.remove(OTHER)).toBe(false);
  });

  test("a file that is not JSON holds no token, and is not thrown at the person", async () => {
    const dir = configDir();
    const store = fileStore(dir);
    await store.write(APP, TOKEN);
    writeFileSync(join(dir, "sluiceway", "tokens.json"), "not json");
    expect(await store.read(APP)).toBeUndefined();
  });
});

describe("the macOS keychain", () => {
  test("keeps the token under the service sluiceway and the app's address", async () => {
    const keychain = fakeKeychain("security");
    const dir = configDir();
    const store = tokenStore({ platform: "darwin", configDir: dir, run: keychain.run });
    expect(await store.write(APP, TOKEN)).toBe("the macOS keychain");
    expect(keychain.items.get(APP)).toBe(TOKEN);
    expect(await store.read(APP)).toBe(TOKEN);
    expect(existsSync(join(dir, "sluiceway", "tokens.json"))).toBe(false);
  });

  test("the token is never an argument of a process, where ps would show it", async () => {
    const keychain = fakeKeychain("security");
    const store = tokenStore({ platform: "darwin", configDir: configDir(), run: keychain.run });
    await store.write(APP, TOKEN);
    await store.read(APP);
    await store.remove(APP);
    for (const call of keychain.calls) expect(call.args.join(" ")).not.toContain(TOKEN);
    expect(keychain.calls[0]?.input).toContain(TOKEN);
  });

  test("remove takes it out of the keychain", async () => {
    const keychain = fakeKeychain("security");
    const store = tokenStore({ platform: "darwin", configDir: configDir(), run: keychain.run });
    await store.write(APP, TOKEN);
    expect(await store.remove(APP)).toEqual(["the macOS keychain"]);
    expect(await store.read(APP)).toBeUndefined();
    expect(await store.remove(APP)).toEqual([]);
  });
});

describe("the Secret Service on Linux", () => {
  test("secret-tool keeps it, read from its stdin", async () => {
    const keychain = fakeKeychain("secret-tool");
    const store = tokenStore({ platform: "linux", configDir: configDir(), run: keychain.run });
    expect(await store.write(APP, TOKEN)).toBe("the Secret Service keyring");
    expect(keychain.items.get(APP)).toBe(TOKEN);
    expect(await store.read(APP)).toBe(TOKEN);
    for (const call of keychain.calls) expect(call.args.join(" ")).not.toContain(TOKEN);
    expect(await store.remove(APP)).toEqual(["the Secret Service keyring"]);
  });
});

describe("falling back to the file", () => {
  test("a Linux without secret-tool", async () => {
    const dir = configDir();
    const store = tokenStore({ platform: "linux", configDir: dir, run: noCommands });
    expect(await store.write(APP, TOKEN)).toBe(join(dir, "sluiceway", "tokens.json"));
    expect(await store.read(APP)).toBe(TOKEN);
  });

  test("a keychain that says it kept the token and did not", async () => {
    const dir = configDir();
    const run: CommandRun = (command) =>
      command === "security" ? { code: 0, stdout: "" } : undefined;
    const store = tokenStore({ platform: "darwin", configDir: dir, run });
    expect(await store.write(APP, TOKEN)).toBe(join(dir, "sluiceway", "tokens.json"));
    expect(JSON.parse(readFileSync(join(dir, "sluiceway", "tokens.json"), "utf8"))).toEqual({
      [APP]: TOKEN,
    });
  });

  test("Windows keeps the file, and runs no command", async () => {
    const calls: string[] = [];
    const dir = configDir();
    const store = tokenStore({
      platform: "win32",
      configDir: dir,
      run: (command) => {
        calls.push(command);
        return undefined;
      },
    });
    expect(await store.write(APP, TOKEN)).toBe(join(dir, "sluiceway", "tokens.json"));
    expect(calls).toEqual([]);
  });

  test("a token kept in the keychain takes the file's place, and logout clears both", async () => {
    const keychain = fakeKeychain("security");
    const dir = configDir();
    await fileStore(dir).write(APP, "sluiceway_old");
    const store = tokenStore({ platform: "darwin", configDir: dir, run: keychain.run });
    await store.write(APP, TOKEN);
    expect(await fileStore(dir).read(APP)).toBeUndefined();
    await fileStore(dir).write(APP, "sluiceway_old");
    expect(await store.remove(APP)).toEqual([
      "the macOS keychain",
      join(dir, "sluiceway", "tokens.json"),
    ]);
  });
});
