// Verification pass for visitjacksoncountywv.com. Free sources only, no API keys.
// Reports. Never edits index.html.
//   node tools/check.mjs            run everything, write data/last-check.md
//   node tools/check.mjs --quick    skip the network checks (lint and queue only)
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSite, allEntities } from './lib/parse-site.mjs';
import { P } from './lib/paths.mjs';

const REGISTRY = P.registry;
const QUICK = process.argv.includes('--quick');
const STALE_MONTHS = 12;
const UA = 'VisitJacksonCountyWV-linkcheck/1.0 (+https://visitjacksoncountywv.com; contact hello@visitjacksoncountywv.com)';
const TODAY = new Date();
const iso = d => d.toISOString().slice(0, 10);

const reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const site = parseSite();
const findings = { links: [], events: [], lint: [], queue: [] };

const root = h => h.replace(/^www\./, '').split('.').slice(-2).join('.');

async function get(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
        signal: AbortSignal.timeout(20000),
      });
      const body = res.headers.get('content-type')?.includes('text') ? await res.text() : '';
      return { ok: res.ok, status: res.status, finalUrl: res.url, body };
    } catch (err) {
      if (attempt) return { ok: false, status: 0, error: String(err.message || err), finalUrl: url, body: '' };
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// ---------- 1. Link liveness ----------
// Some destinations legitimately redirect elsewhere (a Shopify storefront, an
// affiliate hop). Those live in registry.link_exceptions so they stop being noise.
async function checkLinks() {
  const allowed = reg.link_exceptions || {};
  for (const url of site.links) {
    if (url.includes('facebook.com')) {
      findings.links.push({ url, verdict: 'manual', detail: 'Facebook blocks automated checks. Open it yourself.' });
      continue;
    }
    const r = await get(url);
    if (!r.ok) {
      if ([403, 429, 503].includes(r.status)) {
        findings.links.push({ url, verdict: 'blocked', detail: 'HTTP ' + r.status + ', bot protection. The site is probably fine. Open it yourself to confirm.' });
      } else {
        findings.links.push({ url, verdict: 'broken', detail: r.error ? 'no response: ' + r.error : 'HTTP ' + r.status });
      }
      continue;
    }
    const to = root(new URL(r.finalUrl).hostname);
    if (root(new URL(url).hostname) !== to && allowed[url] !== to) {
      findings.links.push({ url, verdict: 'redirected', detail: 'now lands on ' + to + '. If that is correct, point the page straight at it, or add "' + url + '": "' + to + '" to link_exceptions in the registry.' });
      continue;
    }
    if (/domain (is )?(for sale|parking)|buy this domain|parkingcrew|sedoparking/i.test(r.body)) {
      findings.links.push({ url, verdict: 'parked', detail: 'page looks like a domain parking placeholder' });
    }
  }
}

// ---------- 2. Event source freshness ----------
// Year matching is a soft signal. Many small sites render dates in JavaScript, so
// this reports the newest year it can see rather than asserting the event is dead.
async function checkEvents() {
  const thisYear = TODAY.getFullYear();
  for (const ev of reg.event_sources) {
    if (ev.manual) {
      findings.events.push({ event: ev.event, url: ev.url, verdict: 'manual', detail: 'Facebook source. Confirm by hand.' });
      continue;
    }
    const r = await get(ev.url);
    if (!r.ok) {
      const kind = [403, 429, 503].includes(r.status) ? 'blocked' : 'broken';
      findings.events.push({ event: ev.event, url: ev.url, verdict: kind, detail: 'HTTP ' + r.status + (kind === 'blocked' ? ', bot protection. Open it yourself.' : '') });
      continue;
    }
    const text = r.body.replace(/<[^>]+>/g, ' ');
    if (!text.toLowerCase().includes(ev.keyword.toLowerCase())) {
      findings.events.push({ event: ev.event, url: ev.url, verdict: 'off-topic', detail: 'page no longer mentions "' + ev.keyword + '". It may have been repurposed.' });
      continue;
    }
    const years = (text.match(/20[1-3][0-9]/g) || []).map(Number).filter(y => y >= 2015 && y <= thisYear + 2);
    const newest = years.length ? Math.max(...years) : null;
    if (newest === null) continue;
    if (newest < thisYear - 1) {
      findings.events.push({ event: ev.event, url: ev.url, verdict: 'stale', detail: 'newest year on the page is ' + newest + '. Link resolves, but the source looks abandoned.' });
    }
  }
}

// ---------- 3. Registry to page drift ----------
function lint() {
  const onPage = new Map(allEntities(site).map(e => [e.slug, e]));
  const inReg = new Map(reg.entities.map(e => [e.slug, e]));
  for (const [slug, e] of onPage) {
    if (!inReg.has(slug)) findings.lint.push({ verdict: 'new on page', name: e.name, detail: 'not in registry. Run: node .github/verify/sync-registry.mjs --write' });
  }
  for (const [slug, e] of inReg) {
    if (!onPage.has(slug)) findings.lint.push({ verdict: 'gone from page', name: e.name, detail: 'in registry but no longer on the site' });
    else {
      const p = onPage.get(slug);
      const was = (e.appears_in || []).join('+'), now = (p.appears_in || []).join('+');
      if (was !== now) findings.lint.push({ verdict: 'placement changed', name: e.name, detail: was + ' to ' + now });
    }
  }
}

// ---------- 4. Human verification queue ----------
function queue() {
  const cutoff = new Date(TODAY); cutoff.setMonth(cutoff.getMonth() - STALE_MONTHS);
  for (const e of reg.entities) {
    if (e.status === 'closed') continue;
    if (new Date(e.last_verified) > cutoff) continue;
    const q = encodeURIComponent(e.name + ' ' + (e.town || 'Jackson County') + ' WV');
    findings.queue.push({
      name: e.name,
      last_verified: e.last_verified,
      google: 'https://www.google.com/search?q=' + q,
      facebook: e.facebook || 'https://www.facebook.com/search/top?q=' + q,
      website: e.website || null,
    });
  }
}

// ---------- report ----------
function report() {
  const L = [];
  const total = findings.links.filter(f => f.verdict !== 'manual').length
    + findings.events.filter(f => f.verdict !== 'manual').length + findings.lint.length;
  L.push('# Verification pass, ' + iso(TODAY));
  L.push('');
  L.push(total === 0
    ? 'No automated problems found. Nothing on the page is known to be broken.'
    : total + ' item(s) need a look.');
  L.push('');

  const table = (title, rows, head, cells) => {
    L.push('## ' + title);
    L.push('');
    if (!rows.length) { L.push('_Nothing flagged._'); L.push(''); return; }
    L.push('| ' + head.join(' | ') + ' |');
    L.push('|' + head.map(() => '---').join('|') + '|');
    rows.forEach(r => L.push('| ' + cells(r).join(' | ') + ' |'));
    L.push('');
  };

  table('Outbound links', findings.links, ['Status', 'URL', 'Detail'],
    f => [f.verdict, '<' + f.url + '>', f.detail]);
  table('Event sources', findings.events, ['Status', 'Event', 'Detail'],
    f => [f.verdict, '[' + f.event + '](' + f.url + ')', f.detail]);
  table('Registry drift', findings.lint, ['Status', 'Name', 'Detail'],
    f => [f.verdict, f.name, f.detail]);

  L.push('## Human check queue');
  L.push('');
  if (!findings.queue.length) {
    L.push('_Everything verified within the last ' + STALE_MONTHS + ' months._');
  } else {
    L.push('These have not been confirmed in ' + STALE_MONTHS + ' months. Open the links, confirm the business is still trading, then update `last_verified` in `.github/verify/registry.json`.');
    L.push('');
    for (const q of findings.queue) {
      const links = ['[Google](' + q.google + ')', '[Facebook](' + q.facebook + ')'];
      if (q.website) links.push('[Site](' + q.website + ')');
      L.push('- [ ] **' + q.name + '**, last checked ' + q.last_verified + ' ' + links.join(' '));
    }
  }
  L.push('');
  L.push('---');
  L.push('Generated by `.github/verify/check.mjs`. Free sources only, no API keys. Facebook cannot be checked automatically, so it appears here as a manual step.');
  return L.join('\n');
}

if (!QUICK) { await checkLinks(); await checkEvents(); }
lint(); queue();
const md = report();
writeFileSync(P.reportMd, md + '\n');
writeFileSync(P.reportJson, JSON.stringify({ date: iso(TODAY), findings }, null, 2) + '\n');
console.log(md);
