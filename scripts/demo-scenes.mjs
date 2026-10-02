import demoConfig from '../demo.config.json' with { type: 'json' };

// Fictional cast, not real Slack members. Edit the dialogue here between rehearsals.
export const cast = {
  maya: { name: 'Maya — Sales', icon: ':briefcase:' },
  jordan: { name: 'Jordan — Marketing', icon: ':mega:' },
  alex: { name: 'Alex — Design', icon: ':art:' },
  sam: { name: 'Sam — Engineering', icon: ':technologist:' },
};

export const scenes = {
  seed: [
    { actor: 'maya', text: 'A prospect asked if we only frame individual pieces or handle a full display project. Our website introduces the studio, but there isn’t a clear Services section. Can we make the full offering easier to understand?' },
    { actor: 'jordan', text: 'Let’s add a Services section between Studio and Commission so clients can quickly see what we offer.' },
    { actor: 'maya', text: 'Exactly. We do more than framing—we design, build, and install complete displays. That’s what customers need to see.' },
    { actor: 'alex', text: 'Let’s use our existing design and display-case photo so the new section feels like part of the site.' },
    { actor: 'sam', text: `This is the ${demoConfig.vercelProjectName} project in Vercel.` },
  ],
  website: [
    { actor: 'maya', text: 'For the Services preview, check that all six offerings are there: Conservation Framing, Bespoke Display Systems, Design Consultation, In-House Fabrication, White-Glove Installation, and Lasting Presentation. Each should explain what the customer gets, not just show a title.' },
    { actor: 'jordan', text: 'And keep it between Studio and Commission: the “Framing and display, handled end to end” heading, a wide display-case image with an italic caption, then six numbered rows. It should use the site’s existing serif typography, muted colors, and thin rules.' },
    { actor: 'maya', text: 'Let’s check the Services navigation links, the stacked mobile layout, and the existing contact form in the preview before we publish anything.' },
  ],
  playbook: [
    { actor: 'maya', text: 'The website is clearer now. Can we make sure the inbound lead agent knows which projects we actually want?' },
    { actor: 'sam', text: `The prototype is live in the ${demoConfig.vercelProjectName} project in Vercel. It researches companies and posts a fit score in Slack.` },
    { actor: 'maya', text: 'Prioritize full framing and display projects for premium NYC spaces, usually $30–50k. If budget or timing is missing, ask—don’t guess.' },
    { actor: 'jordan', text: 'Position us as an end-to-end studio, not a frame shop. For promising projects, draft a helpful reply offering a design consultation.' },
  ],
};
