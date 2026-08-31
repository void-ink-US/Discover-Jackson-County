// Parses index.html into structured entities. Used by both sync-registry and check
// so the registry and the lint always read the page the same way.
import { readFileSync } from 'node:fs';
import { P } from './paths.mjs';

const decode = s => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '.')
  .replace(/&nbsp;/g, ' ').trim();

export const slug = name => decode(name).toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// URLs that are ours, third-party infrastructure, or dynamic. Never link-checked.
const SKIP_LINK = /^(https?:\/\/)?(www\.)?(google\.com\/(search|maps)|schema\.org|www\.w3\.org|fonts\.g|unpkg\.com|.*cartocdn\.com|www\.googletagmanager\.com|visitjacksoncountywv\.com|buy\.stripe\.com)/;

export function parseSite(path = P.index) {
  const html = readFileSync(path, 'utf8');

  // --- Map POIs: evaluate the literal so field order and spacing do not matter.
  const m = html.match(/var POIS\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('POIS array not found in ' + path);
  const pois = new Function('return ' + m[1])().map(p => ({
    slug: slug(p.n), name: p.n, category: p.c,
    lat: p.lat, lng: p.lng, address: p.a || null, blurb: p.d || null,
  }));

  // --- Dining and shopping reference lists, with the town label they sit under.
  const catref = [];
  for (const section of ['dining', 'shopping']) {
    const start = html.indexOf('id="' + section + '"');
    if (start < 0) continue;
    const block = html.slice(start, html.indexOf('</section>', start));
    let town = null;
    const rowRe = /class="catref-town-label">([^<]*)<|class="catref-item-name">([^<]*)<\/span><span class="catref-item-type">([^<]*)</g;
    let r;
    while ((r = rowRe.exec(block))) {
      if (r[1]) { town = decode(r[1]); continue; }
      catref.push({ slug: slug(r[2]), name: decode(r[2]), section, type: decode(r[3]), town });
    }
  }

  // --- Free directory listings.
  const directory = [];
  const dirRe = /class="directory-item-name">([^<]*)<\/span><span class="directory-item-cat">([^<]*)</g;
  let d;
  while ((d = dirRe.exec(html))) {
    directory.push({ slug: slug(d[1]), name: decode(d[1]), category: decode(d[2]) });
  }

  // --- Outbound links worth checking for rot.
  const links = new Set();
  const linkRe = /href="(https?:\/\/[^"]+)"/g;
  let l;
  while ((l = linkRe.exec(html))) {
    const url = decode(l[1]);
    if (url.includes("'+") || SKIP_LINK.test(url)) continue;
    links.add(url);
  }

  return { pois, catref, directory, links: [...links].sort() };
}

export function allEntities(site) {
  const byslug = new Map();
  const add = (e, where, extra = {}) => {
    const cur = byslug.get(e.slug) || { slug: e.slug, name: e.name, appears_in: [], ...extra };
    cur.appears_in.push(where);
    Object.assign(cur, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)));
    byslug.set(e.slug, cur);
  };
  site.pois.forEach(p => add(p, 'map', {
    category: p.category, address: p.address, lat: p.lat, lng: p.lng,
  }));
  site.catref.forEach(c => add(c, c.section + '-list', { town: c.town, type: c.type }));
  site.directory.forEach(d => add(d, 'directory', { type: d.category }));
  return [...byslug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

if (import.meta.filename === process.argv[1]) {
  const site = parseSite(process.argv[2] || P.index);
  console.log(JSON.stringify({
    counts: { pois: site.pois.length, catref: site.catref.length, directory: site.directory.length, links: site.links.length, entities: allEntities(site).length },
    links: site.links,
  }, null, 2));
}
