import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

import { connectWithMaxRetries, findFreeTcpPort } from "../node_modules/web-ext/lib/firefox/remote.js";

const managedPrefs = [
  ["devtools.debugger.remote-enabled", true],
  ["devtools.debugger.prompt-connection", false],
  ["devtools.chrome.enabled", true]
];

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    temporaryProfile: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--temporary-profile") {
      parsed.temporaryProfile = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }

      parsed[key] = value;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prefLine(key, value) {
  return `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
}

function prefPattern(key) {
  return new RegExp(`^user_pref\\("${escapeRegExp(key)}",\\s*(.+)\\);\\s*$`);
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function splitLines(text) {
  return text ? text.split(/\r?\n/) : [];
}

function captureManagedPrefs(text) {
  const originals = new Map(managedPrefs.map(([key]) => [key, null]));

  for (const line of splitLines(text)) {
    for (const [key] of managedPrefs) {
      const match = line.match(prefPattern(key));

      if (match) {
        originals.set(key, match[1]);
      }
    }
  }

  return originals;
}

function withoutManagedPrefs(text) {
  return splitLines(text).filter((line) => {
    return !managedPrefs.some(([key]) => prefPattern(key).test(line));
  });
}

async function writeManagedPrefs(profilePath) {
  const prefsPath = path.join(profilePath, "prefs.js");
  const originalText = await readTextIfExists(prefsPath);
  const originals = captureManagedPrefs(originalText);
  const nextLines = withoutManagedPrefs(originalText);

  if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
    nextLines.push("");
  }

  for (const [key, value] of managedPrefs) {
    nextLines.push(prefLine(key, value));
  }

  await fs.writeFile(prefsPath, `${nextLines.join(os.EOL)}${os.EOL}`, "utf8");

  return { originals, prefsPath };
}

async function restoreManagedPrefs(prefsPath, originals) {
  const currentText = await readTextIfExists(prefsPath);
  const restoredLines = withoutManagedPrefs(currentText);

  for (const [key, originalValue] of originals.entries()) {
    if (originalValue !== null) {
      restoredLines.push(`user_pref(${JSON.stringify(key)}, ${originalValue});`);
    }
  }

  await fs.writeFile(prefsPath, `${restoredLines.join(os.EOL)}${os.EOL}`, "utf8");
}

async function ensureProfile(profilePath, shouldCreate) {
  if (shouldCreate) {
    await fs.mkdir(profilePath, { recursive: true });
    return profilePath;
  }

  const stats = await fs.stat(profilePath);
  if (!stats.isDirectory()) {
    throw new Error(`Firefox profile path is not a directory: ${profilePath}`);
  }

  return profilePath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.extension) {
    throw new Error("--extension is required");
  }

  if (!options.firefox) {
    throw new Error("--firefox is required");
  }

  if (!options.temporaryProfile && !options.profile) {
    throw new Error("--profile is required unless --temporary-profile is used");
  }

  const profilePath = options.temporaryProfile
    ? options.dryRun
      ? path.join(os.tmpdir(), "my-youtube-styler-firefox-profile-<temporary>")
      : await fs.mkdtemp(path.join(os.tmpdir(), "my-youtube-styler-firefox-profile-"))
    : await ensureProfile(options.profile, false);
  const port = await findFreeTcpPort();
  const firefoxArgs = [
    "-no-remote",
    "-start-debugger-server",
    String(port),
    "-profile",
    profilePath
  ];

  if (options.startUrl) {
    firefoxArgs.push("--url", options.startUrl);
  }

  if (options.dryRun) {
    console.log("Dry run only. Firefox was not launched.");
    console.log(`Command: ${options.firefox}`);
    console.log("Arguments:");
    for (const arg of firefoxArgs) {
      console.log(`  ${arg}`);
    }
    console.log("Managed startup prefs:");
    for (const [key, value] of managedPrefs) {
      console.log(`  ${key} = ${value}`);
    }
    return;
  }

  const prefState = await writeManagedPrefs(profilePath);
  const firefox = spawn(options.firefox, firefoxArgs, {
    stdio: "inherit"
  });
  const firefoxClosed = once(firefox, "close");
  let cancelExitBeforeAttach = () => {};
  const firefoxExitedBeforeAttach = new Promise((_, reject) => {
    const onExit = (code) => {
      reject(new Error(`Firefox exited before the extension could attach. Exit code: ${code}`));
    };

    firefox.once("exit", onExit);
    cancelExitBeforeAttach = () => firefox.off("exit", onExit);
  });

  try {
    const remoteFirefox = await Promise.race([
      connectWithMaxRetries({ port, maxRetries: 250, retryInterval: 120 }),
      firefoxExitedBeforeAttach
    ]);
    cancelExitBeforeAttach();

    remoteFirefox.client.on("error", () => {});

    const result = await remoteFirefox.installTemporaryAddon(path.resolve(options.extension), false);
    const addonId = result?.addon?.id || "unknown add-on";

    remoteFirefox.disconnect();
    console.log(`Attached ${addonId}; launcher remote client disconnected.`);
    await restoreManagedPrefs(prefState.prefsPath, prefState.originals);
    console.log("Restored DevTools startup prefs on disk.");
    console.log("Firefox may still show its DevTools remote-control indicator until this browser session closes.");
  } catch (error) {
    cancelExitBeforeAttach();

    if (!firefox.killed) {
      firefox.kill();
    }

    throw error;
  } finally {
    await firefoxClosed.catch(() => {});
    await restoreManagedPrefs(prefState.prefsPath, prefState.originals);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
