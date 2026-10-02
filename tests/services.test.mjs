import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Services sits between Studio and Commission on the homepage', async () => {
  const page = await read('app/page.tsx');
  assert.match(page, /import \{ Services \} from '@\/components\/services';/);
  assert.match(page, /<About \/>\s*<Services \/>\s*<Pricing \/>/);
});

test('Services is linked from both navigation areas', async () => {
  for (const path of ['components/site-header.tsx', 'components/site-footer.tsx']) {
    assert.match(await read(path), /label: 'Services', href: '#services'/);
  }
});

test('Services describes the full offering and reuses the existing photo', async () => {
  const services = await read('components/services.tsx');
  assert.match(services, /id="services"/);
  assert.match(services, /aria-labelledby="services-heading"/);
  for (const name of ['Custom framing', 'Display design', 'Custom fabrication', 'On-site installation']) {
    assert.ok(services.includes(name));
  }
  assert.match(services, /src="\/images\/display-case.png"/);
  assert.match(services, /href="#contact"/);
  await access(new URL('../public/images/display-case.png', import.meta.url));
});
