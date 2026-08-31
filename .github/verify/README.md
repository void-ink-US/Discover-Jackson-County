# Content Verification Pipeline

Keeps the site honest without turning it into a job. It **reports**, it never edits
`index.html`. You stay the editor.

## Why it is built this way

The most current information about Jackson County businesses lives on Facebook, and
Facebook is the one source that cannot be automated. Reading public Page data through
the Graph API now needs Page Public Content Access or Page Public Metadata Access, and
both require App Review plus business verification before a live app sees real data.
Scraping the public HTML breaks Meta's terms and runs into login walls anyway.

So the pipeline does not try. It uses the sources that are freely machine readable to
narrow the list, then hands you a short Facebook checklist for the handful that look
uncertain. Ten minutes of your time, not an afternoon.

## What it checks

| Check | Source | Catches |
|---|---|---|
| Outbound links | HTTP | Dead sites, expired domains, parked pages, silent domain moves |
| Event sources | HTTP | Official event pages that have been abandoned or repurposed |
| Registry drift | Local | The registry and the page disagreeing after an edit |
| Human queue | Local | Anything not personally confirmed in 12 months |

## Files

| Path | Role |
|---|---|
| `data/registry.json` | Mirror of every business on the page, plus the fields you maintain |
| `tools/lib/parse-site.mjs` | Reads `index.html` into structured entities |
| `tools/sync-registry.mjs` | Rebuilds the registry after you add or remove a business |
| `tools/check.mjs` | Runs the checks, writes `data/last-check.md` |
| `.github/workflows/verify.yml` | Runs quarterly, opens a GitHub issue with the report |

`index.html` remains the source of truth. The registry is a mirror, and the drift check
tells you when the two have gone out of step.

## Running it

Check everything, including the network:

```bash
node tools/check.mjs
```

Skip the network and just look at drift and the human queue:

```bash
node tools/check.mjs --quick
```

After adding or removing a business on the page:

```bash
node tools/sync-registry.mjs --write
```

## Fields you maintain in the registry

Everything else is regenerated from the page. These are yours and survive a rebuild:

- `website`, `facebook`, `phone`
- `last_verified`, the date you personally confirmed the business is still trading
- `status`, set to `closed` to drop it out of the human queue
- `notes`
- `link_exceptions`, a map of URL to the domain it is allowed to redirect to

## Reading the report

- **broken**: the link is genuinely dead. Fix or remove it.
- **redirected**: it lands on a different domain. Either the business moved and the
  page should point at the new address, or it is a legitimate hop and belongs in
  `link_exceptions`.
- **blocked**: HTTP 403 or 429, usually Cloudflare. The site is probably fine. Open it.
- **parked**: the domain expired and is now a placeholder. Remove the link.
- **stale**: an event page still loads but has not mentioned a recent year. Worth a look
  before the season.
- **manual**: Facebook. Only you can check it.

## Schedule

Quarterly, on the first of February, May, August, and November. The May run lands well
before the July 4th traffic, which is when a broken link costs the most. Nothing is
committed automatically. You get a GitHub issue, and it closes itself when a later run
comes back clean.

## What it deliberately does not do

- No Google Places API, so no key, no billing account, and no bill. The trade is that it
  cannot tell you a restaurant with no website has closed. The human queue covers that.
- No automatic edits or pull requests against `index.html`. Editorial copy stays yours.
- No Facebook scraping.

## If you ever want closure detection

Google Places `businessStatus` is the strongest free-tier signal for whether a small
business is still trading, and roughly 240 calls a year sits well inside the free
allowance. It needs a Google Cloud project with billing enabled. The checker is written
so it would drop in as one more module in `tools/check.mjs`.
