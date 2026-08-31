// Every path resolves from the repo root, so the scripts work from any directory.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const VERIFY = join(here, '..');
export const ROOT = join(VERIFY, '..', '..');

export const P = {
  index: join(ROOT, 'index.html'),
  registry: join(VERIFY, 'registry.json'),
  reportMd: join(VERIFY, 'last-check.md'),
  reportJson: join(VERIFY, 'last-check.json'),
};
