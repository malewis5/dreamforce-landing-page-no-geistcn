import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { cast, scenes } from "../scripts/demo-scenes.mjs";
import demoConfig from "../demo.config.json" with { type: "json" };

export const target = {
  connector: process.env.SLACK_CONNECTOR_ID || "slack/dreamforce-landing-page",
  team: process.env.SLACK_TEAM_ID || demoConfig.slackTeamId,
  channel: process.env.SLACK_CHANNEL_ID || demoConfig.slackChannel,
};

export function buildMessage(line, threadTs, channel = target.channel) {
  const actor = cast[line.actor];
  if (!actor || !line.text) throw new Error("Invalid demo dialogue.");
  // Escape Slack control syntax: scene text must not ping users or other agents.
  const text = line.text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return {
    channel,
    username: actor.name,
    icon_emoji: actor.icon,
    text,
    mrkdwn: false,
    parse: "none",
    link_names: false,
    unfurl_links: false,
    unfurl_media: false,
    ...(threadTs ? { thread_ts: threadTs, reply_broadcast: false } : {}),
  };
}

// Only explicit 429 rejections are retried. A timeout or 5xx might have posted;
// keep the pending marker and require inspection instead of risking duplicates.
export async function slackCall(
  token,
  method,
  body,
  { fetchFn = fetch, wait = sleep } = {},
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      const read = method === "conversations.info";
      const url = `https://slack.com/api/${method}${read ? `?${new URLSearchParams(body)}` : ""}`;
      response = await fetchFn(url, {
        method: read ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        ...(read ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        `Slack ${method}: network failure; delivery may be uncertain. No automatic retry.`,
      );
    }
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get("retry-after") ?? 1);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120)
        throw new Error("Slack rate limit requires a later retry.");
      await wait(Math.max(1, seconds) * 1000);
      continue;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Slack ${method}: invalid response; delivery may be uncertain.`,
      );
    }
    if (!response.ok || data.ok !== true) {
      const code = /^[a-z_]+$/.test(data.error ?? "")
        ? data.error
        : `http_${response.status}`;
      throw new Error(`Slack ${method}: ${code}. Check Slack before retrying.`);
    }
    return {
      data,
      scopes: (response.headers.get("x-oauth-scopes") ?? "")
        .split(",")
        .map((s) => s.trim()),
    };
  }
}

function fingerprint(scene) {
  // Include delivery layout so older top-level runs cannot resume as mixed threads.
  return createHash("sha256")
    .update(
      JSON.stringify({
        layout: "scene-thread-v1",
        messages: scenes[scene].map((line) => buildMessage(line)),
      }),
    )
    .digest("hex");
}

export async function playScene({
  state,
  scene,
  one = false,
  post,
  save,
  wait = sleep,
  delay = 3,
  log = console.log,
}) {
  const hash = fingerprint(scene);
  const progress = (state.scenes[scene] ??= { hash, messages: [] });
  if (progress.hash !== hash)
    throw new Error(
      "This scene changed since the run started. Use a new --run NAME to replay the revised dialogue.",
    );
  if (state.pending)
    throw new Error(
      `Uncertain delivery for ${state.pending.scene} line ${state.pending.index + 1}. Inspect Slack and the local state before resuming; do not blindly replay.`,
    );
  let sent = 0;
  for (
    let index = progress.messages.length;
    index < scenes[scene].length;
    index++
  ) {
    const line = scenes[scene][index];
    state.pending = { scene, index };
    await save(state);
    const threadTs = index > 0 ? progress.messages[0].ts : undefined;
    const result = await post(buildMessage(line, threadTs));
    if (typeof result.ts !== "string" || result.channel !== target.channel)
      throw new Error(
        "Slack returned an unexpected message receipt. Inspect delivery before resuming.",
      );
    if (threadTs && result.message?.thread_ts !== threadTs)
      throw new Error(
        "Slack did not confirm the expected thread. Inspect delivery before resuming.",
      );
    progress.messages.push({
      ts: result.ts,
      channel: result.channel,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    delete state.pending;
    await save(state);
    log(
      `Posted ${scene} ${index + 1}/${scenes[scene].length}: ${cast[line.actor].name} (${result.ts}; ${threadTs ? `reply to ${threadTs}` : "thread parent"})`,
    );
    sent++;
    if (one) break;
    if (index < scenes[scene].length - 1) await wait(delay * 1000);
  }
  if (!sent)
    log(
      `${scene} already complete. Use a new --run NAME to replay intentionally.`,
    );
  return sent;
}

export async function preflightSlack(token, options = {}) {
  const { data: auth, scopes } = await slackCall(token, "auth.test", {}, options);
  if (auth.team_id !== target.team)
    throw new Error("Wrong Slack workspace. No messages posted.");
  if (
    !scopes.includes("chat:write") ||
    !scopes.includes("chat:write.customize")
  )
    throw new Error(
      "The connector requires chat:write and chat:write.customize. No messages posted.",
    );
  const { data: info } = await slackCall(
    token,
    "conversations.info",
    { channel: target.channel },
    options,
  );
  if (
    !info.channel ||
    info.channel.id !== target.channel ||
    info.channel.is_archived
  )
    throw new Error("Demo channel unavailable. No messages posted.");
  return { auth, channel: info.channel };
}
