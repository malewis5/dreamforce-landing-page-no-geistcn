import { after } from "next/server.js";
import { getToken } from "@vercel/connect";
import { buildContactSlackMessage } from "./slack-message";
import { contactSubmissionSchema } from "../../../lib/contact";
import { enrichLead } from "../../../lib/lead-enrichment";
import { createLead, saveLead, type StoredLead } from "../../../lib/lead-store";
import demoConfig from "../../../demo.config.json" with { type: "json" };

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  const submission = contactSubmissionSchema.safeParse(body);
  if (!submission.success) {
    return Response.json(
      {
        error: submission.error.issues[0]?.message ?? "Check the form fields.",
      },
      { status: 400 },
    );
  }

  // Confirm only after the small KV write, never after the slower research.
  let lead: StoredLead;
  try {
    lead = await createLead(submission.data);
  } catch {
    console.error("Contact submission could not be saved.");
    return Response.json(
      { error: "Unable to send your message. Please try again." },
      { status: 503 },
    );
  }

  after(async () => {
    try {
      const enrichment = await enrichLead(submission.data);
      lead = { ...lead, enrichment, updatedAt: Math.floor(Date.now() / 1000) };
      await saveLead(lead);
      const token = await getToken(process.env.SLACK_CONNECTOR_ID || "slack/dreamforce-landing-page", {
        subject: { type: "app" },
      });
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: process.env.SLACK_CHANNEL_ID || demoConfig.slackChannel,
          ...buildContactSlackMessage(lead.submission, lead, enrichment),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json();
      // Slack can accept the text while dropping the Work Object. This is an
      // operator configuration issue; report it in server logs, not on the form.
      const warnings: unknown = result.response_metadata?.messages;
      if (
        Array.isArray(warnings) &&
        warnings.some(
          (warning) =>
            typeof warning === "string" &&
            warning.includes("does not support rich preview type"),
        )
      ) {
        console.error("Slack Work Object previews are not enabled for Item.");
        return;
      }
      if (!response.ok || result.ok !== true) {
        throw new Error("Slack delivery failed");
      }
      if (typeof result.channel === "string" && typeof result.ts === "string") {
        await saveLead({
          ...lead,
          slack: { channel: result.channel, ts: result.ts },
        });
      }
    } catch {
      // Redis error details can include the stored command and lead data.
      console.error(
        "Contact enrichment or Slack delivery failed; the submitted lead remains saved.",
      );
    }
  });

  return Response.json({ ok: true }, { status: 202 });
}
