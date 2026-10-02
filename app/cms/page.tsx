import type { Metadata } from 'next';
import { CmsEditor } from '../../components/cms-editor';
import demoConfig from '../../demo.config.json' with { type: 'json' };

export const metadata: Metadata = {
  title: 'Conversation editor — nyc-framing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function CmsPage() {
  return <CmsEditor channel={process.env.SLACK_CHANNEL_ID || demoConfig.slackChannel} />;
}
