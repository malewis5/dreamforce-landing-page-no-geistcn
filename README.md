# nyc-framing

A Next.js landing page for a fictional New York framing and display studio. This
public copy uses local Tailwind styles and form controls instead of
`@vercel/geistcn` and `@vercel/geistcn-assets`.

## Run locally

Use Node.js 24 and pnpm 11 or newer:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Run `pnpm build` for a
production build.

## Contact and demo integrations

The landing page renders without credentials. To accept contact submissions,
configure an Upstash Redis database with `KV_REST_API_URL` and
`KV_REST_API_TOKEN` (or the corresponding `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` variables). Slack delivery uses a Vercel Connect
connection set by `SLACK_CONNECTOR_ID` (default: `slack/demo-agent`). Lead research uses Eve and
requires an AI Gateway key or linked Vercel development credentials.

`demo.config.json` contains example Slack app, workspace, and channel IDs. For a
deployment, set `SLACK_APP_ID`, `SLACK_TEAM_ID`, and `SLACK_CHANNEL_ID` as private
Vercel environment variables before enabling the webhook or running the demo
scripts. Any human who posts an exact demo kickoff message in that public channel
can start its scripted thread. The Slack app must subscribe to `message.channels`
and have permission to read channel messages and post replies. These environment
variables override the example IDs without putting workspace details in the
public repository. No credentials are included in this repository.

## Conversation editor

Open `/cms` to create and edit scripted Slack conversations. Set
`DEMO_CMS_PASSWORD` as a private Vercel environment variable before opening the
editor; sign in with username `editor` and that password. The editor lets you
choose an exact message trigger, the team members and their Slack emoji icons,
and up to eight ordered replies. Saving an enabled conversation makes it live
immediately in the configured public Slack channel. Copy the trigger from the
editor and post it as a new human message in that channel to start a thread.
Disable a conversation to stop new triggers without deleting its script.

Conversation records live in the same Upstash Redis database as the lead data,
under separate `nyc-framing:cms:*` keys. The Services and inbound lead playbook
conversations appear as editable defaults on an empty database. Changes to a
conversation do not replay or modify threads that have already started.

## Project files

- `app/page.tsx` assembles the landing page.
- `app/globals.css` holds the local design tokens and type scale.
- `components/ui/controls.tsx` implements the buttons and form fields.
- `app/api/contact/route.ts` receives validated contact submissions.
- `agent/` and `scripts/` contain the optional research and demo workflows.
