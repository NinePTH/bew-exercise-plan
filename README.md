# Hourglass Balance

A personal workout planner for building an hourglass shape on an inverted-triangle frame. The UI is in Thai.

**Live:** https://ninepth.github.io/bew-exercise-plan/

## What it does

| Tab | Contents |
| --- | --- |
| ออกกำลังกาย (Workout) | Weekly planner (3/4/5-day plans) with daily check-ins, five workout programs with per-exercise ticks, a rest timer, and a stomach-vacuum breathing coach |
| ความคืบหน้า (Progress) | Check-in stats (this week, 3+-day weekly streak, 8-week grid), and a body-measurement tracker with trend charts |
| โภชนาการ & เทคนิค (Nutrition) | Protein calculator (1.2–1.5 g/kg), food guidance, a sample one-day meal plan, and body-type do's and don'ts |

It can be installed to a phone's home screen and works offline after the first visit.

## Where your data lives

Everything is stored in **your browser only** (`localStorage`). Nothing is sent anywhere, and there is no account.

- Another browser, another phone, or a private window starts empty.
- Clearing site data deletes it.
- To keep it safe or move it, use **สำรองข้อมูล (JSON)** on the Progress tab, then **นำเข้าข้อมูล** on the new device. The backup includes measurements, check-in history and plan length.

| Key | Contents |
| --- | --- |
| `hg.measurements.v1` | Measurement entries `{ id, date, weight, waist, hip, note }` |
| `hg.checkins.v1` | Dates checked in, `YYYY-MM-DD` |
| `hg.progress.v1` | Today's exercise ticks and the chosen plan length |

## Project layout

```
index.html            the whole app (HTML, CSS via Tailwind CDN, inline JS)
sw.js                 service worker for offline use
manifest.webmanifest  install metadata
icons/                app icon (SVG source + PNG renders)
tests/                Playwright tests
```

No build step. Edit `index.html` and push.

## Running the tests

Requires Node 22+.

```sh
npm install
npx playwright install chromium
npm test
```

The tests start a local server on port 4173 automatically. They also run on GitHub Actions for every push and pull request (see the **Actions** tab).

## Deploying

GitHub Pages serves the `main` branch root. Pushing to `main` deploys in about a minute.

If you change the list of files in `sw.js`'s precache, bump `CACHE` in `sw.js` so installed copies pick up the change.
