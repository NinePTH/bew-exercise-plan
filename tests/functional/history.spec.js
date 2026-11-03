const { test, expect } = require('@playwright/test');
const fs = require('fs');

// A fixed "now" keeps week maths deterministic: Wednesday 4 Nov 2026, 10:00 local time.
const WED = new Date(2026, 10, 4, 10, 0, 0);
const CHECKINS_KEY = 'hg.checkins.v1';
const PROGRESS_KEY = 'hg.progress.v1';
const MEASURE_KEY = 'hg.measurements.v1';

async function open(page, hash = '', storage = {}) {
    await page.clock.install({ time: WED });
    await page.addInitScript(entries => {
        if (sessionStorage.getItem('__seeded')) return;
        sessionStorage.setItem('__seeded', '1');
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, JSON.stringify(v));
    }, storage);
    await page.goto('/index.html' + hash);
}

const checkins = page => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), CHECKINS_KEY);

test.describe('check-in history', () => {
    test('a check-in is stored as the real date and survives reload', async ({ page }) => {
        await open(page);
        await page.click('button[aria-label="เช็กชื่อวันจันทร์"]');
        await page.click('button[aria-label="เช็กชื่อวันพุธ"]');
        expect(await checkins(page)).toEqual(['2026-11-02', '2026-11-04']);
        await page.reload();
        await expect(page.locator('button[aria-label="เช็กชื่อวันพุธ"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('unchecking removes the date', async ({ page }) => {
        await open(page);
        const mon = page.locator('button[aria-label="เช็กชื่อวันจันทร์"]');
        await mon.click();
        await mon.click();
        expect(await checkins(page)).toEqual([]);
    });

    test("days that haven't happened yet can't be checked", async ({ page }) => {
        await open(page);
        const thu = page.locator('button[aria-label="เช็กชื่อวันพฤหัสบดี"]');
        await expect(thu).toBeDisabled();
        await page.evaluate(() => toggleDayCheck('sun'));
        expect(await checkins(page)).toEqual([]);
    });

    test("last week's check-ins stay in the history but leave this week's planner", async ({ page }) => {
        await open(page, '', { [CHECKINS_KEY]: ['2026-10-26', '2026-10-28'] });
        await expect(page.locator('button[aria-label="เช็กชื่อวันจันทร์"]')).toHaveAttribute('aria-pressed', 'false');
        await page.click('[data-nav=progress]');
        await expect(page.locator('#statTotal')).toContainText('2');
        await expect(page.locator('[data-day="2026-10-26"]')).toHaveClass(/bg-rose-500/);
    });

    test('the planner opens on today', async ({ page }) => {
        await open(page);
        await expect(page.locator('#dayTrackerContainer > div').nth(2)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#selectedDayBanner')).toContainText('พุธ');
    });

    test('old-format ticks from this week are folded into the history', async ({ page }) => {
        await open(page, '', {
            [PROGRESS_KEY]: { date: '2026-11-03', week: '2026-11-02', freq: 4, exDone: {}, days: { mon: true, tue: true, fri: true } }
        });
        // Friday is in the future, so it is dropped.
        expect(await checkins(page)).toEqual(['2026-11-02', '2026-11-03']);
    });
});

test.describe('check-in stats', () => {
    test('counts this week against the plan, and the total', async ({ page }) => {
        await open(page, '#progress', { [CHECKINS_KEY]: ['2026-10-20', '2026-11-02', '2026-11-03'] });
        await expect(page.locator('#statWeek')).toContainText('2 / 4');
        await expect(page.locator('#statTotal')).toContainText('3');
    });

    test('streak counts past weeks with 3+ days, and this week once it qualifies', async ({ page }) => {
        const twoGoodWeeks = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-29'];
        await open(page, '#progress', { [CHECKINS_KEY]: [...twoGoodWeeks, '2026-11-02'] });
        // This week has 1 day so far: it doesn't break the streak, it just doesn't add to it yet.
        await expect(page.locator('#statStreak')).toContainText('2');

        await page.click('[data-nav=workout]');
        await page.click('button[aria-label="เช็กชื่อวันอังคาร"]');
        await page.click('button[aria-label="เช็กชื่อวันพุธ"]');
        await page.click('[data-nav=progress]');
        await expect(page.locator('#statStreak')).toContainText('3');
    });

    test('a week with fewer than 3 days ends the streak', async ({ page }) => {
        await open(page, '#progress', { [CHECKINS_KEY]: ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-26', '2026-10-27', '2026-10-28'] });
        await expect(page.locator('#statStreak')).toContainText('1');
    });

    test('shows an 8-week grid with future days marked', async ({ page }) => {
        await open(page, '#progress');
        await expect(page.locator('#checkinStats [data-day]')).toHaveCount(56);
        await expect(page.locator('[data-day="2026-11-05"]')).toHaveClass(/border-dashed/);
        await expect(page.locator('[data-day="2026-11-04"]')).toHaveClass(/ring-2/);
    });

    test('changing the plan length updates the weekly target', async ({ page }) => {
        await open(page);
        await page.click('#planBtn-5');
        await page.click('[data-nav=progress]');
        await expect(page.locator('#statWeek')).toContainText('0 / 5');
    });
});

test.describe('midnight rollover', () => {
    test("yesterday's exercise ticks clear if the page stayed open overnight", async ({ page }) => {
        await page.clock.install({ time: new Date(2026, 10, 4, 23, 58, 0) });
        await page.goto('/index.html');
        await page.evaluate(() => toggleExerciseDone('ex1'));
        await expect(page.locator('#completedExercisesCount')).toHaveText('1');

        await page.clock.fastForward('05:00');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(page.locator('#completedExercisesCount')).toHaveText('0');
        // Yesterday's tick stays in the history; today starts empty.
        const log = await page.evaluate(() => JSON.parse(localStorage.getItem('hg.exlog.v1')));
        expect(log).toEqual({ '2026-11-04': ['ex1'] });
    });

    test('ticking after midnight without switching away also rolls over first', async ({ page }) => {
        await page.clock.install({ time: new Date(2026, 10, 4, 23, 58, 0) });
        await page.goto('/index.html');
        await page.evaluate(() => toggleExerciseDone('ex1'));
        await page.clock.fastForward('05:00');
        await page.evaluate(() => toggleExerciseDone('ex2'));
        await expect(page.locator('#completedExercisesCount')).toHaveText('1');
    });
});

test.describe('backup includes check-ins and plan length', () => {
    test('round-trips onto a fresh browser', async ({ page, browser }) => {
        await open(page, '', { [CHECKINS_KEY]: ['2026-10-26', '2026-10-28', '2026-11-02'] });
        await page.click('#planBtn-5');
        await page.click('[data-nav=progress]');
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
        const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        expect(data.version).toBe(3);
        expect(data.checkins).toEqual(['2026-10-26', '2026-10-28', '2026-11-02']);
        expect(data.planFreq).toBe(5);

        const fresh = await (await browser.newContext()).newPage();
        await fresh.clock.install({ time: WED });
        await fresh.goto('/index.html#progress');
        await fresh.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
        await expect(fresh.locator('#backupMsg')).toContainText('เช็กชื่อ 3 วัน');
        await expect(fresh.locator('#statTotal')).toContainText('3');
        await expect(fresh.locator('#statWeek')).toContainText('1 / 5');
        await fresh.reload();
        expect(await fresh.evaluate(() => currentPlanFreq)).toBe(5);
        await expect(fresh.locator('#statTotal')).toContainText('3');
    });

    test('ignores invalid and future check-in dates in a backup', async ({ page }) => {
        await open(page, '#progress');
        const data = { measurements: [], checkins: ['2026-11-01', '2026-13-01', 'nope', '2026-12-25', 42], planFreq: 9 };
        await page.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
        await expect(page.locator('#backupMsg')).toContainText('เช็กชื่อ 1 วัน'); // import is async: wait for it
        expect(await checkins(page)).toEqual(['2026-11-01']);
        expect(await page.evaluate(() => currentPlanFreq)).toBe(4);
    });
});

test.describe('review fixes', () => {
    test('deleting a measurement can be undone', async ({ page }) => {
        await open(page, '#progress', { [MEASURE_KEY]: [{ id: 'a', date: '2026-11-01', weight: 50, waist: 68, hip: 92, note: '' }] });
        await page.click('button[title="ลบรายการนี้"]');
        await expect(page.locator('#measureRows')).toContainText('ยังไม่มีข้อมูล');
        await page.click('#undoDeleteBtn');
        await expect(page.locator('#measureRows tr')).toHaveCount(1);
        await page.reload();
        await expect(page.locator('#measureRows tr')).toHaveCount(1);
    });

    test('malformed saved measurements are dropped instead of breaking the page', async ({ page }) => {
        await open(page, '#progress', { [MEASURE_KEY]: [{ nope: true }, { id: 'a', date: '2026-11-01', weight: 50, note: '' }, null] });
        await expect(page.locator('#measureRows tr')).toHaveCount(1);
    });

    test('the rest timer follows the clock, not the number of ticks', async ({ page }) => {
        await open(page);
        await page.evaluate(() => { setTimer(30); toggleTimer(); });
        await page.clock.fastForward('00:10');
        await expect(page.locator('#timerDisplay')).toHaveText('00:20');
        await page.clock.fastForward('00:25');
        await expect(page.locator('#timerDisplay')).toHaveText('00:00');
        await expect(page.locator('#timerStatus')).toContainText('ครบเวลาแล้ว');
    });

    test('an entry with an impossible date is refused instead of vanishing on reload', async ({ page }) => {
        await open(page, '#progress');
        await page.evaluate(() => {
            document.getElementById('mDate').value = '20266-11-04'; // what a mistyped year can produce
            document.getElementById('mWeight').value = '50';
            addMeasurement(new Event('submit'));
        });
        await expect(page.locator('#measureError')).toBeVisible();
        await expect(page.locator('#measureRows')).toContainText('ยังไม่มีข้อมูล');
    });

    test('a weight typed into the protein calculator is not overwritten by a delete', async ({ page }) => {
        await open(page, '#progress', { [MEASURE_KEY]: [
            { id: 'a', date: '2026-10-01', weight: 52, note: '' },
            { id: 'b', date: '2026-11-01', weight: 50, note: '' }
        ] });
        await page.click('[data-nav=nutrition]');
        await page.fill('#proteinWeight', '60');
        await page.click('[data-nav=progress]');
        await page.locator('button[title="ลบรายการนี้"]').last().click(); // the older entry; latest weight is unchanged
        await page.click('[data-nav=nutrition]');
        await expect(page.locator('#proteinWeight')).toHaveValue('60');
    });

    test('an empty file gives a clear message', async ({ page }) => {
        await open(page, '#progress');
        await page.setInputFiles('#importFile', { name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.from('  \n') });
        await expect(page.locator('#backupMsg')).toContainText('ไฟล์ว่างเปล่า');
        await page.setInputFiles('#importFile', { name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from('') });
        await expect(page.locator('#backupMsg')).toContainText('ไฟล์ว่างเปล่า');
    });

    test('a second open copy does not erase what the first one saved', async ({ context }) => {
        const a = await context.newPage(), b = await context.newPage();
        await a.goto('/index.html#progress');
        await b.goto('/index.html#progress');
        await a.fill('#mWeight', '50');
        await a.click('#measureForm button[type=submit]');
        await expect(b.locator('#measureRows tr')).toHaveCount(1); // b picked up a's save
        await b.fill('#mWeight', '49.5');
        await b.click('#measureForm button[type=submit]');
        await a.reload();
        await expect(a.locator('#measureRows tr')).toHaveCount(2);
    });

    test('after midnight the planner moves to the new day and the form date follows', async ({ page }) => {
        await page.clock.install({ time: new Date(2026, 10, 4, 23, 58, 0) });
        await page.goto('/index.html');
        await page.clock.fastForward('05:00');
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(page.locator('#dayTrackerContainer > div').nth(3)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#mDate')).toHaveValue('2026-11-05');
    });

    test('planner days work from the keyboard', async ({ page }) => {
        await open(page);
        const fri = page.locator('#dayTrackerContainer > div').nth(4);
        await fri.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#dayTrackerContainer > div').nth(4)).toHaveAttribute('aria-pressed', 'true');
    });
});
