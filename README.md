# Dreamforce landing page

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
connection set by `SLACK_CONNECTOR_ID` (default: `slack/dreamforce-landing-page`). Lead research uses Eve and
requires an AI Gateway key or linked Vercel development credentials.

`demo.config.json` contains example Slack app, workspace, channel, and presenter
IDs. For a deployment, set `SLACK_APP_ID`, `SLACK_TEAM_ID`, `SLACK_CHANNEL_ID`,
and `SLACK_TRIGGER_USER_ID` as private Vercel environment variables before
enabling the webhook or running the demo scripts. These override the example
IDs without putting workspace details in the public repository. No credentials
are included in this repository.

## Project files

- `app/page.tsx` assembles the landing page.
- `app/globals.css` holds the local design tokens and type scale.
- `components/ui/controls.tsx` implements the buttons and form fields.
- `app/api/contact/route.ts` receives validated contact submissions.
- `agent/` and `scripts/` contain the optional research and demo workflows.
