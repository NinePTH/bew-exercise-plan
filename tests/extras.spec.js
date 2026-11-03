const { test, expect } = require('@playwright/test');
const fs = require('fs');

// Wednesday 4 Nov 2026, 10:00 local time.
const WED = new Date(2026, 10, 4, 10, 0, 0);
const EXLOG_KEY = 'hg.exlog.v1';
const MEASURE_KEY = 'hg.measurements.v1';

async function open(page, hash = '', storage = {}, opts = {}) {
    await page.clock.install({ time: opts.time || WED });
    await page.addInitScript(entries => {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, storage);
    await page.goto('/index.html' + hash);
}

const exlog = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), EXLOG_KEY);

test.describe('exercise history', () => {
    test('ticks are logged per date and the next day starts fresh', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { toggleExerciseDone('ex1'); toggleExerciseDone('ex2'); });
        expect(await exlog(page)).toEqual({ '2026-11-04': ['ex1', 'ex2'] });

        await page.clock.setSystemTime(new Date(2026, 10, 5, 9, 0, 0));
        await page.reload();
        await expect(page.locator('#completedExercisesCount')).toHaveText('0');
        expect(await exlog(page)).toEqual({ '2026-11-04': ['ex1', 'ex2'] });
    });

    test('unticking removes it from the log', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { toggleExerciseDone('ex1'); toggleExerciseDone('ex1'); });
        expect(await exlog(page)).toEqual({});
    });

    test('the Progress tab lists the last 7 days and the total', async ({ page }) => {
        await open(page, '#progress', { [EXLOG_KEY]: {
            '2026-11-04': ['ex1'], '2026-11-02': ['ex4', 'ex5'], '2026-10-20': ['ex7']
        } });
        const list = page.locator('#exerciseHistory li');
        await expect(list).toHaveCount(2); // 20 Oct is older than 7 days
        await expect(list.first()).toContainText('04/11');
        await expect(list.first()).toContainText('Kettlebell Goblet Squat');
        await expect(list.nth(1)).toContainText('Core Deadbug · Dumbbell Rear Delt Fly');
        await expect(page.locator('#statExTotal')).toHaveText('4');
    });

    test('a day with exercises but no check-in shows as a lighter square', async ({ page }) => {
        await open(page, '#progress', { [EXLOG_KEY]: { '2026-11-03': ['ex1'] }, 'hg.checkins.v1': ['2026-11-02'] });
        await expect(page.locator('[data-day="2026-11-02"]')).toHaveClass(/bg-rose-500/);
        await expect(page.locator('[data-day="2026-11-03"]')).toHaveClass(/bg-rose-200/);
        await expect(page.locator('[data-day="2026-11-03"]')).toHaveAttribute('title', /1 ท่า/);
    });

    test('ignores unknown exercises, bad dates and future dates in storage', async ({ page }) => {
        await open(page, '#progress', { [EXLOG_KEY]: {
            '2026-11-04': ['ex1', 'nope', 'ex1'], 'bad': ['ex2'], '2026-12-01': ['ex3'], '2026-11-03': 'ex4'
        } });
        await expect(page.locator('#statExTotal')).toHaveText('1');
    });

    test("today's ticks saved by the old format are moved into the log", async ({ page }) => {
        await open(page, '', { 'hg.progress.v1': { date: '2026-11-04', freq: 5, exDone: { ex1: true, ex7: true } } });
        await expect(page.locator('#completedExercisesCount')).toHaveText('2');
        expect(await exlog(page)).toEqual({ '2026-11-04': ['ex1', 'ex7'] });
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hg.progress.v1')))).toEqual({ freq: 5 });
    });

    test('the backup carries the exercise log and restores it', async ({ page, browser }) => {
        await open(page, '#progress', { [EXLOG_KEY]: { '2026-11-03': ['ex4'], '2026-11-04': ['ex1'] } });
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
        const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        expect(data.exerciseLog).toEqual({ '2026-11-03': ['ex4'], '2026-11-04': ['ex1'] });

        const fresh = await (await browser.newContext()).newPage();
        await fresh.clock.install({ time: WED });
        await fresh.goto('/index.html#progress');
        await fresh.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
        await expect(fresh.locator('#backupMsg')).toContainText('ท่าฝึก 2 รายการ');
        await expect(fresh.locator('#statExTotal')).toHaveText('2');
        await expect(fresh.locator('#completedExercisesCount')).toHaveText('1'); // today's tick is back on the card
    });
});

test.describe('weekly measurement reminder', () => {
    const entry = date => ({ id: 'a' + date, date, weight: 50, note: '' });

    test('shows a banner when the last measurement is 7+ days old', async ({ page }) => {
        await open(page, '', { [MEASURE_KEY]: [entry('2026-10-28')] });
        await expect(page.locator('#reminderBanner')).toContainText('วัดครั้งล่าสุด 7 วันก่อน');
        await page.click('#reminderBanner a');
        await expect(page).toHaveURL(/#progress$/);
    });

    test('stays hidden with a recent measurement, or with none at all', async ({ page }) => {
        await open(page, '', { [MEASURE_KEY]: [entry('2026-10-29')] });
        await expect(page.locator('#reminderBanner')).toBeEmpty();
        await expect(page.locator('#reminderBanner')).toBeHidden();
        await page.evaluate(k => localStorage.removeItem(k), MEASURE_KEY);
        await page.reload();
        await expect(page.locator('#reminderBanner')).toBeEmpty();
    });

    test('"later" hides it until tomorrow', async ({ page }) => {
        await open(page, '', { [MEASURE_KEY]: [entry('2026-10-20')] });
        await page.click('#reminderBanner button');
        await expect(page.locator('#reminderBanner')).toBeEmpty();
        await page.reload();
        await expect(page.locator('#reminderBanner')).toBeEmpty();
        await page.clock.setSystemTime(new Date(2026, 10, 5, 9, 0, 0));
        await page.reload();
        await expect(page.locator('#reminderBanner')).toContainText('16 วันก่อน');
    });

    test('logging a measurement clears it', async ({ page }) => {
        await open(page, '#progress', { [MEASURE_KEY]: [entry('2026-10-20')] });
        await page.fill('#mWeight', '49.8');
        await page.click('#measureForm button[type=submit]');
        await expect(page.locator('#reminderBanner')).toBeEmpty();
    });

    test('the calendar file repeats weekly on the chosen day and time', async ({ page }) => {
        await open(page, '#progress');
        await page.selectOption('#remDay', '5'); // Saturday
        await page.fill('#remTime', '08:30');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#remIcsBtn')]);
        expect(download.suggestedFilename()).toBe('hourglass-measure-reminder.ics');
        const ics = fs.readFileSync(await download.path(), 'utf8');

        expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
        expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=SA\r\n');
        expect(ics).toContain('DTSTART:20261107T083000\r\n'); // the coming Saturday
        expect(ics).toContain('BEGIN:VALARM');
        expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:วัดสัดส่วน (เอว / สะโพก / น้ำหนัก)');
        expect(ics.replace(/\r\n /g, '')).toContain('#progress');
        // Every physical line fits the 75-byte limit, and no bare LF line breaks.
        for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
        expect(ics.replace(/\r\n/g, '')).not.toContain('\n');

        await expect(page.locator('#reminderMsg')).toContainText('เสาร์');
        await page.reload();
        await expect(page.locator('#remDay')).toHaveValue('5');
        await expect(page.locator('#remTime')).toHaveValue('08:30');
    });

    test("today's weekday starts next week if the time has already passed", async ({ page }) => {
        await open(page);
        const starts = await page.evaluate(() => {
            const now = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 10:00
            const f = d => d.toISOString().slice(0, 10) + ' ' + d.getHours() + ':' + d.getMinutes();
            return [nextReminderStart(2, '09:00', now), nextReminderStart(2, '11:00', now), nextReminderStart(0, '07:00', now)].map(f);
        });
        expect(starts.map(s => s.split(' ')[1])).toEqual(['9:0', '11:0', '7:0']);
        const dates = await page.evaluate(() => {
            const now = new Date(2026, 10, 4, 10, 0, 0);
            return [nextReminderStart(2, '09:00', now), nextReminderStart(2, '11:00', now), nextReminderStart(0, '07:00', now)].map(localDateStr);
        });
        expect(dates).toEqual(['2026-11-11', '2026-11-04', '2026-11-09']);
    });
});

test.describe('dark mode', () => {
    const pageBg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    test('follows the device setting by default', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/index.html');
        expect(await pageBg(page)).toBe('rgb(14, 14, 18)');
        await expect(page.locator('#themeLabel')).toHaveText('อัตโนมัติ');
        await page.emulateMedia({ colorScheme: 'light' });
        expect(await pageBg(page)).toBe('rgb(253, 248, 246)');
    });

    test('the button cycles auto → light → dark → auto and remembers the choice', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/index.html');
        await page.click('#themeBtn');
        await expect(page.locator('#themeLabel')).toHaveText('สว่าง');
        expect(await pageBg(page)).toBe('rgb(253, 248, 246)'); // forced light on a dark device

        await page.reload();
        expect(await pageBg(page)).toBe('rgb(253, 248, 246)');
        await page.click('#themeBtn');
        await expect(page.locator('#themeLabel')).toHaveText('มืด');
        await page.emulateMedia({ colorScheme: 'light' });
        expect(await pageBg(page)).toBe('rgb(14, 14, 18)'); // forced dark on a light device

        await page.click('#themeBtn');
        await expect(page.locator('#themeLabel')).toHaveText('อัตโนมัติ');
        expect(await page.evaluate(() => localStorage.getItem('hg.theme'))).toBeNull();
    });

    test('cards and tinted boxes switch, the header and white button text do not', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/index.html');
        const style = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
        expect(await style('#exerciseList > div', 'backgroundColor')).toBe('rgb(27, 27, 33)'); // surface
        expect(await style('header p', 'color')).toBe('rgb(255, 228, 230)'); // rose-100 stays light on the header
        expect(await style('#startPauseBtn', 'color')).toBe('rgb(255, 255, 255)');
    });

    test('a saved choice applies before the page paints', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('hg.theme', 'dark'));
        await page.goto('/index.html');
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    });
});

test.describe('built stylesheet', () => {
    test('no request goes to the Tailwind CDN', async ({ page }) => {
        const hosts = [];
        page.on('request', r => hosts.push(new URL(r.url()).hostname));
        await page.goto('/index.html');
        expect(hosts).not.toContain('cdn.tailwindcss.com');
        await expect(page.locator('h1')).toHaveCSS('font-size', '30px');
    });

    test('every class used in the page exists in styles.css', async ({ page }) => {
        // Guards against forgetting `npm run build:css` after adding a class.
        await page.goto('/index.html#progress');
        const missing = await page.evaluate(() => {
            const known = new Set();
            for (const sheet of document.styleSheets) {
                let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
                const walk = list => { for (const r of list) {
                    if (r.selectorText) (r.selectorText.match(/\.((?:\\.|[\w-])+)/g) || []).forEach(m => known.add(m.slice(1).replace(/\\/g, '')));
                    if (r.cssRules) walk(r.cssRules);
                } };
                walk(rules);
            }
            const ignore = /^(ph(-|$)|chart-hit|chart-tip|glass-card|active-tab|breathing-circle|keep-light|c-)/;
            const used = new Set();
            document.querySelectorAll('[class]').forEach(el => {
                (typeof el.className === 'string' ? el.className : el.getAttribute('class')).split(/\s+/).forEach(c => c && used.add(c));
            });
            return [...used].filter(c => !ignore.test(c) && !known.has(c));
        });
        expect(missing).toEqual([]);
    });
});
