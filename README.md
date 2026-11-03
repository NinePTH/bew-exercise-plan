# Hourglass Balance

A personal workout planner for building an hourglass shape on an inverted-triangle frame. The UI is in Thai.

**Live:** https://ninepth.github.io/bew-exercise-plan/

## What it does

| Tab | Contents |
| --- | --- |
| ออกกำลังกาย (Workout) | Weekly planner (3/4/5-day plans) with daily check-ins, five workout programs with per-exercise ticks, a rest timer, and a stomach-vacuum breathing coach |
| ความคืบหน้า (Progress) | Check-in stats (this week, 3+-day weekly streak, 8-week grid), the last 7 days of exercises, and a body-measurement tracker with trend charts and a weekly reminder |
| โภชนาการ & เทคนิค (Nutrition) | Protein calculator (1.2–1.5 g/kg), food guidance, a sample one-day meal plan, and body-type do's and don'ts |

It can be installed to a phone's home screen and works offline after the first visit. It has a light and a dark theme; the button in the header switches between following the device, light, and dark.

**Weekly reminder.** A website can't schedule phone notifications without a server, so the reminder works two ways: the app shows a banner when the last measurement is 7 or more days old, and **เพิ่มลงปฏิทิน (.ics)** downloads a weekly repeating event with an alert for the phone's calendar app, which reminds you even when the app is closed.

## Where your data lives

Everything is stored in **your browser only** (`localStorage`). Nothing is sent anywhere, and there is no account.

- Another browser, another phone, or a private window starts empty.
- Clearing site data deletes it.
- To keep it safe or move it, use **สำรองข้อมูล (JSON)** on the Progress tab, then **นำเข้าข้อมูล** on the new device. The backup includes measurements, check-in history, the exercise log and plan length.

| Key | Contents |
| --- | --- |
| `hg.measurements.v1` | Measurement entries `{ id, date, weight, waist, hip, note }` |
| `hg.checkins.v1` | Dates checked in, `YYYY-MM-DD` |
| `hg.exlog.v1` | Exercises ticked per date, `{ "YYYY-MM-DD": ["ex1", ...] }` |
| `hg.progress.v1` | The chosen plan length |
| `hg.reminder.v1` | Reminder weekday and time |
| `hg.theme` | `light` or `dark` when chosen; absent means follow the device |

## Project layout

```
index.html            the whole app (HTML and inline JS)
styles.css            built stylesheet (generated, committed; don't edit by hand)
src/tailwind.css      stylesheet source: theme colours, dark mode, custom CSS
tailwind.config.js    Tailwind setup; turns palette colours into CSS variables for dark mode
core.js               pure logic (dates, streaks, import, calendar file), unit tested
sw.js                 service worker for offline use
manifest.webmanifest  install metadata
icons/                app icon (SVG source + PNG renders)
tests/                unit, functional and end-to-end tests
.githooks/pre-push    runs the tests before every push
```

After changing classes in `index.html` or anything in `src/` or `tailwind.config.js`, rebuild the stylesheet and commit `styles.css`:

```sh
npm run build:css
```

`npm test` rebuilds it first, one test fails if the page uses a class that `styles.css` doesn't contain, and the pre-push hook stops a push whose `styles.css` is stale.

**How dark mode works:** every palette colour is a CSS variable. In dark mode the light tints and dark inks swap (`rose-50` ⇄ `rose-950`, and so on), so classes like `bg-rose-50 text-rose-900` need no `dark:` variants. Use `bg-surface` for card and input backgrounds (white in light mode). Add `keep-light` to an area that should look the same in both themes, like the header.

## Tests

Requires Node 22+. First time:

```sh
npm install
npx playwright install chromium
git config core.hooksPath .githooks   # run the tests before every push (see below)
```

Three layers, all run by `npm test` (about 1.5 minutes):

| Layer | Where | What it checks | Run alone |
| --- | --- | --- | --- |
| Unit | `tests/unit/` | Pure logic in `core.js`: dates and weeks (month/year ends, leap years, daylight saving), streaks, CSV parsing, entry validation, the calendar file. Node's built-in runner, no browser, under a second. | `npm run test:unit` |
| Functional | `tests/functional/` | One feature at a time in a real browser: tabs, planner, measurements, charts, backup/restore, offline, dark mode, reminders, edge cases. | `npm run test:functional` |
| End-to-end | `tests/e2e/` | Whole user journeys through the UI only: the first two weeks of use, moving to a new phone, training offline, using it on a phone in dark mode, the rest timer, adding the calendar reminder. | `npm run test:e2e` |

The browser tests start a local server on port 4173 automatically. Pure logic lives in `core.js` so it can be unit tested; anything that touches the page or storage stays in `index.html`.

**Before every push:** `.githooks/pre-push` runs `npm test` and cancels the push if anything fails, or if `styles.css` was out of date (it is rebuilt; commit it and push again). Enable it once per clone with `git config core.hooksPath .githooks`. To skip it in an emergency: `git push --no-verify`.

**On GitHub:** `.github/workflows/test.yml` runs the same tests on every push and pull request, once GitHub Actions is available on the account.

## Deploying

GitHub Pages serves the `main` branch root. Pushing to `main` deploys in about a minute.

If you change the list of files in `sw.js`'s precache, bump `CACHE` in `sw.js` so installed copies pick up the change.
