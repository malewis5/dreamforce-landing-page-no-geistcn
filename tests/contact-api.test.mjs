import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, mock, test } from "node:test";
import { researchResultSchema } from "../lib/lead-research.ts";
import { BUDGETS } from "../lib/contact.ts";
import demoConfig from "../demo.config.json" with { type: "json" };

const routeUrl = new URL("../app/api/contact/route.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === routeUrl && specifier.startsWith(".") && !specifier.endsWith(".json")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const tasks = [];
const getToken = mock.fn(async () => "test-token");
const unavailable = { status: "unavailable", createdAt: 1789000000 };
const complete = {
  status: "complete",
  sessionId: "session_contact-123",
  createdAt: 1789000000,
  research: researchResultSchema.parse({
    companyDescription: "Acme designs software in a premium Manhattan office.",
    match: "matched",
    nycOffice: "confirmed",
    premiumOffice: "strong",
    purchaseIntent: "exploratory",
    confidence: "high",
    rationale:
      "Its NYC office and premium workspace are a strong furniture fit.",
    sources: [
      { title: "Acme offices", url: "https://example.com/acme/offices" },
    ],
  }),
};
const identity = {
  id: "lead-12345678-1234-4234-8234-123456789abc",
  createdAt: 1789000000,
  updatedAt: 1789000000,
};
const storedLead = (submission) => ({ ...identity, submission });
const enrichLead = mock.fn(async () => complete);
const createLead = mock.fn(async (submission) => storedLead(submission));
const saveLead = mock.fn(async () => {});
mock.module("next/server.js", {
  exports: { after: (callback) => tasks.push(callback) },
});
mock.module("@vercel/connect", { exports: { getToken } });
mock.module(new URL("../lib/lead-enrichment.ts", import.meta.url).href, {
  exports: { enrichLead },
});
mock.module(new URL("../lib/lead-store.ts", import.meta.url).href, {
  exports: { createLead, saveLead },
});
const { POST } = await import(routeUrl);
hooks.deregister();

const submission = {
  name: "Jane Doe",
  email: "jane@example.com",
  company: "Acme",
  teamSize: "11–50",
  budget: "$30,000–$50,000",
  message: "Help with our launch.\nWe have two teams.",
};
function request(body) {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach((t) => {
  tasks.length = 0;
  getToken.mock.resetCalls();
  getToken.mock.mockImplementation(async () => "test-token");
  enrichLead.mock.resetCalls();
  enrichLead.mock.mockImplementation(async () => complete);
  createLead.mock.resetCalls();
  createLead.mock.mockImplementation(async (submission) =>
    storedLead(submission),
  );
  saveLead.mock.resetCalls();
  saveLead.mock.mockImplementation(async () => {});
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
});

test("rejects invalid submissions without scheduling background work", async () => {
  for (const body of [
    "{invalid",
    null,
    {},
    { ...submission, teamSize: "" },
    { ...submission, message: " " },
    { ...submission, message: "x".repeat(201) },
    { ...submission, name: "x".repeat(61) },
    { ...submission, email: "invalid" },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal(tasks.length, 0);
  assert.equal(createLead.mock.callCount(), 0);
  assert.equal(saveLead.mock.callCount(), 0);
  assert.equal(enrichLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
});

test("requires a valid budget before persistence or any background work", async () => {
  const { budget: _budget, ...missingBudget } = submission;
  for (const body of [
    missingBudget,
    ...[null, "", " ", 30000, {}, "Select budget", "$30,000-$50,000"].map(
      (budget) => ({ ...submission, budget }),
    ),
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Select a budget." });
  }
  assert.equal(tasks.length, 0);
  assert.equal(createLead.mock.callCount(), 0);
  assert.equal(saveLead.mock.callCount(), 0);
  assert.equal(enrichLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("accepts every budget option and preserves it in the initial save", async () => {
  for (const budget of BUDGETS) {
    const input = { ...submission, budget };
    assert.equal((await POST(request(input))).status, 202);
    assert.deepEqual(createLead.mock.calls.at(-1).arguments, [input]);
  }
  assert.equal(createLead.mock.callCount(), BUDGETS.length);
  assert.equal(tasks.length, BUDGETS.length);
  assert.equal(enrichLead.mock.callCount(), 0);
});

test("waits for the original submission to be saved before accepting, without starting research", async (t) => {
  const write = Promise.withResolvers();
  const started = Promise.withResolvers();
  t.after(() => write.resolve(storedLead(submission)));
  createLead.mock.mockImplementation((input) => {
    started.resolve(input);
    return write.promise;
  });
  let acknowledged = false;
  const responsePromise = POST(request(submission)).then((response) => {
    acknowledged = true;
    return response;
  });
  assert.deepEqual(await started.promise, submission);
  await new Promise(setImmediate);
  assert.equal(acknowledged, false);
  assert.equal(tasks.length, 0);
  assert.equal(enrichLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
  write.resolve(storedLead(submission));
  const response = await responsePromise;
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(tasks.length, 1);
  assert.equal(enrichLead.mock.callCount(), 0);
});

test("failed initial persistence returns a generic 503 without scheduling work or leaking data", async (t) => {
  createLead.mock.mockImplementation(async () => {
    throw new Error(`private-kv-error: ${submission.email}`);
  });
  const log = t.mock.method(console, "error", () => {});
  const response = await POST(request(submission));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Unable to send your message. Please try again.",
  });
  assert.equal(createLead.mock.callCount(), 1);
  assert.equal(tasks.length, 0);
  assert.equal(enrichLead.mock.callCount(), 0);
  assert.equal(saveLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(
    JSON.stringify(log.mock.calls).includes("private-kv-error"),
    false,
  );
  assert.equal(
    JSON.stringify(log.mock.calls).includes(submission.email),
    false,
  );
});

test("accepts after persistence, then enriches and saves before sending the Work Object", async (t) => {
  const enrichment = Promise.withResolvers();
  const write = Promise.withResolvers();
  const saving = Promise.withResolvers();
  t.after(() => {
    enrichment.resolve(complete);
    write.resolve();
  });
  t.mock.method(Date, "now", () => 1789000200000);
  enrichLead.mock.mockImplementation(() => enrichment.promise);
  saveLead.mock.mockImplementation((lead) => {
    saving.resolve(lead);
    return write.promise;
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ok: true }),
  );

  const response = await POST(
    request({
      ...submission,
      name: " Jane Doe ",
      message: ` ${submission.message} `,
    }),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(tasks.length, 1);
  assert.equal(
    enrichLead.mock.callCount(),
    0,
    "research must not delay the acceptance response",
  );
  assert.deepEqual(
    createLead.mock.calls.map((call) => call.arguments),
    [[submission]],
  );
  assert.equal(saveLead.mock.callCount(), 0);
  assert.equal(getToken.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);

  const work = tasks[0]();
  assert.deepEqual(enrichLead.mock.calls[0].arguments, [submission]);
  assert.equal(saveLead.mock.callCount(), 0);
  assert.equal(fetchMock.mock.callCount(), 0);
  enrichment.resolve(complete);
  assert.deepEqual(await saving.promise, {
    ...storedLead(submission),
    enrichment: complete,
    updatedAt: 1789000200,
  });
  assert.equal(
    getToken.mock.callCount(),
    0,
    "Slack credentials must wait for enrichment persistence",
  );
  assert.equal(fetchMock.mock.callCount(), 0);
  write.resolve();
  await work;
  assert.equal(
    saveLead.mock.callCount(),
    1,
    "no Slack coordinates were returned to save",
  );
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(getToken.mock.calls[0].arguments, [
    "slack/demo-agent",
    { subject: { type: "app" } },
  ]);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, "https://slack.com/api/chat.postMessage");
  const body = JSON.parse(options.body);
  assert.equal(body.channel, demoConfig.slackChannel);
  const item = body.metadata.entities[0];
  assert.equal(item.entity_type, "slack#/entities/item");
  assert.deepEqual(item.external_ref, { id: identity.id, type: "lead" });
  assert.equal(
    item.entity_payload.attributes.metadata_last_modified,
    1789000200,
  );
  const fields = Object.fromEntries(
    item.entity_payload.custom_fields.map((field) => [field.key, field.value]),
  );
  assert.equal(fields.full_name, submission.name);
  assert.equal(fields.description, submission.message);
  assert.equal(fields.budget, submission.budget);
  assert.ok(item.entity_payload.display_order.includes("budget"));
  assert.equal(fields.icp_fit, "92/100 · Strong fit");
  assert.equal(fields.company_overview, complete.research.companyDescription);
  assert.equal(fields.research_source_0, complete.research.sources[0].url);
});

test("lead delivery follows the shared channel config, not a hard-coded destination", async (t) => {
  const previous = demoConfig.slackChannel;
  t.after(() => { demoConfig.slackChannel = previous; });
  demoConfig.slackChannel = "CNEWCHANNEL";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  assert.equal((await POST(request(submission))).status, 202);
  await tasks[0]();
  assert.equal(JSON.parse(fetchMock.mock.calls[0].arguments[1].body).channel, "CNEWCHANNEL");
});

test("background enrichment failure still delivers a numeric score from known signals", async (t) => {
  enrichLead.mock.mockImplementation(async () => unavailable);
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ok: true }),
  );
  const response = await POST(request(submission));
  assert.equal(response.status, 202);
  await tasks[0]();
  const item = JSON.parse(fetchMock.mock.calls[0].arguments[1].body).metadata
    .entities[0];
  assert.equal(item.external_ref.id, identity.id);
  assert.equal(saveLead.mock.callCount(), 1);
  const persisted = saveLead.mock.calls[0].arguments[0];
  assert.equal(persisted.id, identity.id);
  assert.equal(persisted.createdAt, identity.createdAt);
  assert.deepEqual(persisted.submission, submission);
  assert.deepEqual(persisted.enrichment, unavailable);
  assert.equal(
    item.entity_payload.attributes.metadata_last_modified,
    persisted.updatedAt,
  );
  const fields = Object.fromEntries(
    item.entity_payload.custom_fields.map((field) => [field.key, field.value]),
  );
  assert.equal(fields.budget, submission.budget);
  assert.equal(fields.icp_fit, "42/100 · Low fit");
  assert.equal(fields.confidence, "Unavailable");
  assert.equal(fields.full_name, submission.name);
  assert.equal(fields.description, submission.message);
});

test("stores Slack channel and timestamp only after successful delivery", async (t) => {
  const slack = { channel: demoConfig.slackChannel, ts: "1789000200.123456" };
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ok: true, ...slack }),
  );
  assert.equal((await POST(request(submission))).status, 202);
  await tasks[0]();
  assert.equal(saveLead.mock.callCount(), 2);
  const [enriched, delivered] = saveLead.mock.calls.map(
    (call) => call.arguments[0],
  );
  assert.equal(enriched.slack, undefined);
  assert.deepEqual(delivered, { ...enriched, slack });
  assert.equal(delivered.id, identity.id);
  assert.deepEqual(delivered.submission, submission);
});

test("failed enrichment persistence prevents Slack delivery after acceptance and logs no lead data", async (t) => {
  saveLead.mock.mockImplementation(async () => {
    throw new Error(`private-kv-error: ${submission.email}`);
  });
  const log = t.mock.method(console, "error", () => {});
  const response = await POST(request(submission));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  await assert.doesNotReject(tasks[0]);
  assert.equal(createLead.mock.callCount(), 1);
  assert.equal(saveLead.mock.callCount(), 1);
  assert.equal(getToken.mock.callCount(), 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(
    JSON.stringify(log.mock.calls).includes("private-kv-error"),
    false,
  );
  assert.equal(
    JSON.stringify(log.mock.calls).includes(submission.email),
    false,
  );
});

test("Slack configuration warnings stay in server logs, not the visitor response", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      ok: true,
      response_metadata: {
        messages: [
          "[WARN] App does not support rich preview type slack#/entities/item",
        ],
      },
    }),
  );
  const log = t.mock.method(console, "error", () => {});
  const response = await POST(request(submission));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  await assert.doesNotReject(tasks[0]);
  assert.match(log.mock.calls[0].arguments[0], /Work Object previews/);
});

test("Slack delivery errors are caught after acceptance", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ ok: false, error: "invalid_blocks" }),
  );
  const log = t.mock.method(console, "error", () => {});
  const response = await POST(request(submission));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  await assert.doesNotReject(tasks[0]);
  assert.equal(log.mock.callCount(), 1);
});
