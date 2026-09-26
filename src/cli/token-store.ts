// Where `sluiceway login` keeps the person's token (record 0116): the
// operating system's keychain where there is one, and otherwise a file under
// the person's config directory that only they can read. One token per app
// address, so a token for a test app never takes the place of the real one.
// The app moved from FORMER_APP to DEFAULT_APP: a token kept under the former
// address is the default app's until the next login keeps it under the new one.
//
// The keychain's own command (`security` on macOS, `secret-tool` on Linux) is
// the one process the command line starts. The token goes to it on stdin and
// is never an argument, where any process on the machine could read it.

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_APP, FORMER_APP } from "./args.ts";

export interface TokenStore {
  read(app: string): Promise<string | undefined>;
  // Where the token was kept, in words for the person.
  write(app: string, token: string): Promise<string>;
  // Every place a token was taken out of.
  remove(app: string): Promise<string[]>;
}

// One place a token can be kept.
interface Place {
  where: string;
  read(app: string): string | undefined;
  // True when the token is there afterwards, read back.
  write(app: string, token: string): boolean;
  remove(app: string): boolean;
}

// Runs a command with stdin, and says its exit code and stdout, or nothing
// when the command is not there.
export type CommandRun = (
  command: string,
  args: string[],
  input?: string,
) => { code: number; stdout: string } | undefined;

const SERVICE = "sluiceway";

// The file alone, for a test and for the store below.
export function fileStore(configDir: string): {
  read(app: string): Promise<string | undefined>;
  write(app: string, token: string): Promise<string>;
  remove(app: string): Promise<boolean>;
} {
  const place = filePlace(configDir);
  return {
    read: async (app) => place.read(app),
    write: async (app, token) => {
      place.write(app, token);
      return place.where;
    },
    remove: async (app) => place.remove(app),
  };
}

function filePlace(configDir: string): Place {
  const dir = join(configDir, "sluiceway");
  const file = join(dir, "tokens.json");
  const load = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      return parsed !== null && typeof parsed === "object"
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  };
  const save = (tokens: Record<string, string>): void => {
    if (Object.keys(tokens).length === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(file, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
    // A file that was there keeps its mode through a write.
    chmodSync(file, 0o600);
  };
  return {
    where: file,
    read: (app) => {
      const token = load()[app];
      return typeof token === "string" ? token : undefined;
    },
    write: (app, token) => {
      save({ ...load(), [app]: token });
      return true;
    },
    remove: (app) => {
      const tokens = load();
      if (!(app in tokens)) return false;
      delete tokens[app];
      save(tokens);
      return true;
    },
  };
}

// The macOS keychain, through `security`. Its interactive mode reads the
// command from stdin, so the token is not an argument.
function macKeychain(run: CommandRun): Place {
  const read = (app: string): string | undefined => {
    const found = run("security", ["find-generic-password", "-a", app, "-s", SERVICE, "-w"]);
    return found?.code === 0 ? found.stdout.replace(/\n$/, "") : undefined;
  };
  return {
    where: "the macOS keychain",
    read,
    write: (app, token) => {
      const line = `add-generic-password -U -a "${app}" -s "${SERVICE}" -l "Sluiceway" -w "${token}"\n`;
      run("security", ["-i"], line);
      return read(app) === token;
    },
    remove: (app) =>
      run("security", ["delete-generic-password", "-a", app, "-s", SERVICE])?.code === 0,
  };
}

// The Secret Service (GNOME Keyring, KWallet), through `secret-tool`, which
// reads the secret from stdin.
function secretService(run: CommandRun): Place {
  const attributes = (app: string) => ["service", SERVICE, "app", app];
  const read = (app: string): string | undefined => {
    const found = run("secret-tool", ["lookup", ...attributes(app)]);
    return found?.code === 0 && found.stdout !== "" ? found.stdout.replace(/\n$/, "") : undefined;
  };
  return {
    where: "the Secret Service keyring",
    read,
    write: (app, token) => {
      run("secret-tool", ["store", "--label=Sluiceway", ...attributes(app)], token);
      return read(app) === token;
    },
    remove: (app) => run("secret-tool", ["clear", ...attributes(app)])?.code === 0,
  };
}

// The keychain of the platform first, the file after it. Windows keeps the
// file under the person's profile: its credential manager has no command
// that takes a secret on stdin.
export function tokenStore(options: {
  platform: string;
  configDir: string;
  run: CommandRun;
}): TokenStore {
  const file = filePlace(options.configDir);
  const keychain =
    options.platform === "darwin"
      ? macKeychain(options.run)
      : options.platform === "linux"
        ? secretService(options.run)
        : undefined;
  const places = keychain === undefined ? [file] : [keychain, file];
  const readAt = (app: string): string | undefined => {
    for (const place of places) {
      const token = place.read(app);
      if (token !== undefined) return token;
    }
    return undefined;
  };
  const removeAt = (app: string): string[] =>
    places.filter((place) => place.remove(app)).map((place) => place.where);
  // The addresses a token for this app may be kept under, the app's own first.
  const addresses = (app: string): string[] => (app === DEFAULT_APP ? [app, FORMER_APP] : [app]);
  return {
    read: async (app) => {
      for (const address of addresses(app)) {
        const token = readAt(address);
        if (token !== undefined) return token;
      }
      return undefined;
    },
    write: async (app, token) => {
      let where: string;
      if (keychain?.write(app, token)) {
        file.remove(app);
        where = keychain.where;
      } else {
        file.write(app, token);
        where = file.where;
      }
      for (const address of addresses(app).slice(1)) removeAt(address);
      return where;
    },
    remove: async (app) => [...new Set(addresses(app).flatMap(removeAt))],
  };
}
