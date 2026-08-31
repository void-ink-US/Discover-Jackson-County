// Rebuilds data/registry.json from index.html, preserving everything a human typed.
// Run this after adding or removing a business on the page.
//   node tools/sync-registry.mjs          report only
//   node tools/sync-registry.mjs --write  save changes
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseSite, allEntities } from './lib/parse-site.mjs';
import { P } from './lib/paths.mjs';

const REGISTRY = P.registry;
const WRITE = process.argv.includes('--write');
const TODAY = new Date().toISOString().slice(0, 10);

// Fields the operator owns. Never overwritten from the page.
const HUMAN = ['facebook', 'website', 'phone', 'last_verified', 'status', 'notes', 'alias_of'];

const prev = existsSync(REGISTRY)
  ? JSON.parse(readFileSync(REGISTRY, 'utf8'))
  : { generated: null, seeded: TODAY, entities: [] };
const prevBySlug = new Map((prev.entities || []).map(e => [e.slug, e]));

// A business that changes its name gets a new slug. Carry the hand-typed fields
// across so a rename does not silently lose the phone, website, and notes.
//   node .github/verify/sync-registry.mjs --rename old-slug=new-slug --write
for (const arg of process.argv) {
  if (!arg.startsWith('--rename=') && process.argv[process.argv.indexOf('--rename') + 1] !== arg) continue;
  const pair = arg.startsWith('--rename=') ? arg.slice(9) : arg;
  if (!pair.includes('=')) continue;
  const [from, to] = pair.split('=');
  const old = prevBySlug.get(from);
  if (!old) { console.log('rename: no registry entry for ' + from); continue; }
  prevBySlug.set(to, { ...old, slug: to });
  prevBySlug.delete(from);
  console.log('rename: carried fields from ' + from + ' to ' + to);
}

const site = parseSite();
const entities = allEntities(site).map(e => {
  const old = prevBySlug.get(e.slug) || {};
  const rec = {
    slug: e.slug,
    name: e.name,
    category: e.category || null,
    type: e.type || null,
    town: e.town || guessTown(e),
    address: e.address || null,
    lat: e.lat ?? null,
    lng: e.lng ?? null,
    appears_in: e.appears_in,
    website: null, facebook: null, phone: null,
    status: 'active',
    last_verified: prev.seeded || TODAY,
    notes: '',
  };
  for (const k of HUMAN) if (old[k] !== undefined && old[k] !== null && old[k] !== '') rec[k] = old[k];
  return rec;
});

function guessTown(e) {
  const a = (e.address || '') + ' ' + (e.name || '');
  if (/Ravenswood/i.test(a)) return 'Ravenswood';
  if (/Ripley/i.test(a)) return 'Ripley';
  if (/Cottageville/i.test(a)) return 'Cottageville';
  return null;
}

const added = entities.filter(e => !prevBySlug.has(e.slug)).map(e => e.name);
const removed = [...prevBySlug.values()].filter(e => !entities.some(n => n.slug === e.slug)).map(e => e.name);

const out = {
  note: 'Mirror of index.html for verification. The page is the source of truth. Regenerate with: node .github/verify/sync-registry.mjs --write',
  generated: TODAY,
  seeded: prev.seeded || TODAY,
  link_exceptions: prev.link_exceptions || {},
  event_sources: prev.event_sources || [
    { event: 'Ripley 4th of July', url: 'https://www.ripleyfourthofjuly.com', keyword: 'ripley' },
    { event: 'Mountain State Art & Craft Fair', url: 'https://www.msacf.com/', keyword: 'craft' },
    { event: 'Jackson County Jr. Fair', url: 'https://www.jacksoncountyjrfair.org', keyword: 'fair' },
    { event: 'Ohio River Festival', url: 'https://www.cityofravenswood.com/ohio-river-festival', keyword: 'festival' },
    { event: 'Harvest & Wood Festival', url: 'https://www.cityofravenswood.com/harvest-wood', keyword: 'harvest' },
    { event: 'Ripley Veterans Day Parade', url: 'https://www.facebook.com/ripleyveteransdayparade', keyword: 'veterans', manual: true },
  ],
  counts: { entities: entities.length, pois: site.pois.length, catref: site.catref.length, directory: site.directory.length, links: site.links.length },
  entities,
};

console.log(`entities ${entities.length}  (map ${site.pois.length}, lists ${site.catref.length}, directory ${site.directory.length})`);
if (added.length) console.log('ADDED:  ' + added.join(', '));
if (removed.length) console.log('REMOVED: ' + removed.join(', '));
if (!added.length && !removed.length && existsSync(REGISTRY)) console.log('no membership change');

if (WRITE) {
  writeFileSync(REGISTRY, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote registry.json');
} else {
  console.log('(dry run, pass --write to save)');
}
