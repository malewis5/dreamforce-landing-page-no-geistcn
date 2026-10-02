import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cast, scenes } from "./demo-scenes.mjs";
import demoConfig from "../demo.config.json" with { type: "json" };
import {
  target,
  buildMessage,
  slackCall,
  playScene,
  preflightSlack,
} from "../lib/demo-runner.mjs";

export { target, buildMessage, slackCall, playScene };

const root = fileURLToPath(new URL("../", import.meta.url));
const help = `${demoConfig.vercelProjectName} demo director (Vercel Connect)
  pnpm demo seed                      Post the opening conversation
  pnpm demo play website              Play a scene (website or playbook)
  pnpm demo next playbook             Post just the next line of a scene
  pnpm demo status                    Show saved progress
  pnpm demo play playbook --dry-run   Preview without credentials or Slack calls

Options: --run NAME (default: rehearsal), --delay SECONDS (default: 3; minimum: 1)
Use a new --run NAME to explicitly replay. Completed lines are skipped within a run.
Each scene starts one parent message; the remaining lines reply in its thread.
All live posts go only to workspace ${target.team}, channel ${target.channel}.
Change slackChannel in demo.config.json to switch both scenes and inbound leads.
Progress is separate per workspace, channel, and run name.
No Slack Code mentions, approvals, customer messages, or deletion of Slack history.
`;

export function parseOptions(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      run: { type: "string", default: "rehearsal" },
      delay: { type: "string", default: "3" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = values.help ? "help" : (positionals[0] ?? "help");
  if (!["seed", "play", "next", "status", "help"].includes(command))
    throw new Error("Unknown command. Run pnpm demo --help.");
  const scene = command === "seed" ? "seed" : positionals[1];
  if (
    ["seed", "play", "next"].includes(command) &&
    !Object.hasOwn(scenes, scene)
  )
    throw new Error("Choose a scene: seed, website, playbook.");
  if (positionals.length > (["play", "next"].includes(command) ? 2 : 1))
    throw new Error("Unexpected positional arguments.");
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(values.run))
    throw new Error(
      "Run name must be 1–60 letters, numbers, underscores, or hyphens.",
    );
  const delay = Number(values.delay);
  if (!Number.isFinite(delay) || delay < 1 || delay > 60)
    throw new Error("Delay must be between 1 and 60 seconds.");
  return { command, scene, run: values.run, delay, dryRun: values["dry-run"] };
}

export function statePath(directory, run, destination = target) {
  return resolve(directory, destination.team, destination.channel, `${run}.json`);
}

async function readSavedState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readState(directory, run, destination = target) {
  try {
    let state = await readSavedState(statePath(directory, run, destination));
    if (state === undefined) {
      // Honor same-channel legacy receipts without rewriting or deleting them.
      // A different channel gets independent progress, never the old thread ID.
      const legacy = await readSavedState(resolve(directory, `${run}.json`));
      if (legacy !== undefined) {
        if (legacy.version !== 1 || legacy.run !== run
          || typeof legacy.team !== "string" || typeof legacy.channel !== "string")
          throw new Error("Invalid legacy state.");
        if (legacy.team === destination.team && legacy.channel === destination.channel)
          state = legacy;
      }
    }
    if (state === undefined) {
      return {
        version: 1, run, team: destination.team, channel: destination.channel, scenes: {},
      };
    }
    if (
      state.version !== 1 ||
      state.run !== run ||
      state.team !== destination.team ||
      state.channel !== destination.channel ||
      !state.scenes ||
      typeof state.scenes !== "object" ||
      Array.isArray(state.scenes)
    )
      throw new Error("Invalid state.");
    for (const [scene, progress] of Object.entries(state.scenes)) {
      if (
        !Object.hasOwn(scenes, scene) ||
        typeof progress.hash !== "string" ||
        !Array.isArray(progress.messages) ||
        progress.messages.some(
          (m) => typeof m.ts !== "string" || m.channel !== destination.channel,
        )
      )
        throw new Error("Invalid progress.");
    }
    return state;
  } catch {
    throw new Error(
      "Demo state is invalid or unreadable; inspect it before posting.",
    );
  }
}

async function connect() {
  // Use Next's installed env loader with development precedence, without printing secrets.
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require(
    require.resolve("@next/env", {
      paths: [require.resolve("next/package.json")],
    }),
  );
  loadEnvConfig(root, true, { info() {}, error() {} });
  try {
    const { getToken } = await import("@vercel/connect");
    return await getToken(target.connector, { subject: { type: "app" } });
  } catch {
    throw new Error(
      "Vercel Connect authentication failed. Refresh this project’s local Vercel development credentials; no raw token is needed.",
    );
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === "help") {
    console.log(help);
    return;
  }
  const stateDirectory = resolve(root, ".demo-state");
  const path = statePath(stateDirectory, options.run);
  if (options.dryRun && options.scene) {
    for (const [index, line] of (options.command === "next"
      ? scenes[options.scene].slice(0, 1)
      : scenes[options.scene]
    ).entries()) {
      console.log(
        `[${index === 0 ? "Parent" : "Thread reply"}] ${cast[line.actor].name}: ${line.text}\n`,
      );
    }
    console.log(
      "Dry run only: no credentials, Slack requests, or progress changes. Shows dialogue from the start.",
    );
    return;
  }
  if (options.command === "status") {
    console.log(JSON.stringify(await readState(stateDirectory, options.run), null, 2));
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  // One lock across all runs: two processes must not interleave scenes in the channel.
  const lockPath = resolve(stateDirectory, "director.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error(
      "Another demo runner is active (or left a stale .demo-state/director.lock). Check it before retrying.",
    );
  }
  try {
    await lock.writeFile(String(process.pid));
    const state = await readState(stateDirectory, options.run);
    if (state.pending)
      throw new Error(
        "A previous message has uncertain delivery. Inspect Slack and the pending local state before resuming.",
      );
    const token = await connect();
    const { auth, channel } = await preflightSlack(token);
    console.log(
      `Vercel Connect → ${auth.team} / #${channel.name}; run=${options.run}`,
    );
    await playScene({
      state,
      scene: options.scene,
      one: options.command === "next",
      delay: options.delay,
      post: async (body) =>
        (await slackCall(token, "chat.postMessage", body)).data,
      save: async (value) => {
        await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, {
          mode: 0o600,
        });
        await rename(`${path}.tmp`, path);
      },
    });
    console.log(
      `Open Slack: slack://channel?team=${target.team}&id=${target.channel}`,
    );
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
