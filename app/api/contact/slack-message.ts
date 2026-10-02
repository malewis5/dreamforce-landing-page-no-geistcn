import type { ContactSubmission } from '../../../lib/contact';
import type { LeadEnrichment } from '../../../lib/lead-enrichment';
import { scoreLead } from '../../../lib/lead-research';
import demoConfig from '../../../demo.config.json' with { type: 'json' };

export type LeadIdentity = {
  id: string;
  createdAt: number;
  updatedAt?: number;
};

// The Work Object identifies the saved KV record, regardless of enrichment status.
// The placeholder URL contains no form data and is not a public CRM page.
export function buildContactSlackMessage(
  input: Pick<ContactSubmission, 'name' | 'company' | 'teamSize' | 'message'> & { budget?: ContactSubmission['budget'] },
  identity: LeadIdentity,
  enrichment?: LeadEnrichment,
) {
  const research = enrichment?.status === 'complete' ? enrichment.research : undefined;
  const fit = scoreLead(research, input.teamSize, input.budget);
  const researchFields = [
    { key: 'icp_fit', label: 'ICP fit', type: 'string', value: `${fit.score}/100 · ${fit.label}` },
    ...(research ? [
      { key: 'company_overview', label: 'Company overview', type: 'string', value: research.companyDescription, long: true },
      { key: 'fit_reason', label: 'Why it fits', type: 'string', value: research.rationale, long: true },
      { key: 'confidence', label: 'Research confidence', type: 'string', value: research.confidence },
      ...research.sources.map((source, index) => ({ key: `research_source_${index}`, label: source.title, type: 'slack#/types/link', value: source.url })),
    ] : [
      { key: 'confidence', label: 'Research confidence', type: 'string', value: enrichment ? 'Unavailable' : 'Pending' },
    ]),
  ];
  return {
    text: 'New inbound lead from the Contact Us Form.',
    mrkdwn: false,
    parse: 'none',
    metadata: {
      entities: [
        {
          entity_type: 'slack#/entities/item',
          external_ref: { id: identity.id, type: 'lead' },
          url: `https://example.com/demo/leads/${encodeURIComponent(identity.id)}`,
          entity_payload: {
            attributes: {
              title: { text: 'Inbound Lead' },
              display_type: 'Lead',
              display_id: `LEAD-${identity.id.replace(/^lead-/, '').slice(0, 8)}`,
              product_name: demoConfig.vercelProjectName,
              metadata_last_modified: identity.updatedAt ?? identity.createdAt,
            },
            // Generic Item entities use custom_fields, not a fields object.
            // Omit markdown formatting so submitted values remain plain text.
            custom_fields: [
              { key: 'full_name', label: 'Full Name', type: 'string', value: input.name },
              { key: 'company', label: 'Company', type: 'string', value: input.company },
              { key: 'team_size', label: 'Size', type: 'string', value: input.teamSize },
              { key: 'budget', label: 'Budget (USD)', type: 'string', value: input.budget ?? 'Not provided' },
              { key: 'status', label: 'Status', type: 'string', value: 'New', tag_color: 'blue' },
              { key: 'description', label: 'Message', type: 'string', value: input.message, long: true },
              { key: 'source', label: 'Source', type: 'string', value: 'Contact Us Form' },
              ...researchFields,
            ],
            display_order: [
              'full_name', 'company', 'budget',
              ...researchFields.filter((field) => !field.key.startsWith('research_source_')).map((field) => field.key),
              'team_size', 'status', 'description', 'source',
              ...researchFields.filter((field) => field.key.startsWith('research_source_')).map((field) => field.key),
            ],
          },
        },
      ],
    },
    unfurl_links: false,
    unfurl_media: false,
  };
}
