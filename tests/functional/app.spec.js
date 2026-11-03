const { test, expect } = require('@playwright/test');

const PROGRESS_KEY = 'hg.progress.v1';
const MEASURE_KEY = 'hg.measurements.v1';

function localDate(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

async function fillEntry(page, { weight = '', waist = '', hip = '', note = '' }) {
    await page.fill('#mWeight', String(weight));
    await page.fill('#mWaist', String(waist));
    await page.fill('#mHip', String(hip));
    await page.fill('#mNote', note);
    await page.click('#measureForm button[type=submit]');
}

test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
});

test.describe('section navigation', () => {
    // Uses rendered display, not the `hidden` property: utility classes like `grid` can override [hidden].
    const visiblePanels = page => page.evaluate(() =>
        [...new Set([...document.querySelectorAll('[data-panel]')]
            .filter(el => getComputedStyle(el).display !== 'none')
            .map(el => el.dataset.panel))]);

    test('opens on the workout section by default', async ({ page }) => {
        await expect.poll(() => visiblePanels(page)).toEqual(['workout']);
        await expect(page.locator('[data-nav=workout]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('#measureSection')).toBeHidden();
    });

    test('tapping a tab shows only that section and updates the URL', async ({ page }) => {
        await page.click('[data-nav=progress]');
        await expect.poll(() => visiblePanels(page)).toEqual(['progress']);
        await expect(page).toHaveURL(/#progress$/);
        await expect(page.locator('[data-nav=progress]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('[data-nav=workout]')).not.toHaveAttribute('aria-current', 'page');

        await page.click('[data-nav=nutrition]');
        await expect.poll(() => visiblePanels(page)).toEqual(['nutrition']);
        await expect(page.locator('#proteinResult')).toBeVisible();
    });

    test('a direct #progress link opens that section, and survives reload', async ({ page }) => {
        await page.goto('/index.html#progress');
        await expect(page.locator('#measureSection')).toBeVisible();
        await page.reload();
        await expect(page.locator('#measureSection')).toBeVisible();
    });

    test('an unknown hash falls back to workout', async ({ page }) => {
        await page.goto('/index.html#nonsense');
        await expect.poll(() => visiblePanels(page)).toEqual(['workout']);
    });

    test('back button returns to the previous section', async ({ page }) => {
        await page.click('[data-nav=nutrition]');
        await page.goBack();
        await expect(page.locator('[data-nav=workout]')).toHaveAttribute('aria-current', 'page');
    });

    test('the workout timer keeps running while on another tab', async ({ page }) => {
        await page.evaluate(() => { setTimer(30); toggleTimer(); });
        await page.click('[data-nav=progress]');
        await page.waitForTimeout(2200);
        await page.click('[data-nav=workout]');
        const text = await page.locator('#timerDisplay').innerText();
        expect(text).not.toBe('00:30');
    });
});

test.describe('measurement tracker', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/index.html#progress');
    });

    test('saves an entry and restores it after reload', async ({ page }) => {
        await fillEntry(page, { weight: 50.2, waist: 68, hip: 92, note: 'เริ่มต้นโปรแกรม' });
        await expect(page.locator('#measureRows tr')).toHaveCount(1);

        await page.reload();
        const row = page.locator('#measureRows tr');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('สัปดาห์ที่ 1');
        await expect(row).toContainText('50.2');
        await expect(row).toContainText('เริ่มต้นโปรแกรม');
        await expect(page.locator('#measureSummary')).toContainText('0.74');
    });

    test('shows change since the first entry and numbers weeks from it', async ({ page }) => {
        await page.evaluate(([key, first]) => {
            localStorage.setItem(key, JSON.stringify([
                { id: 'a', date: first, weight: 50, waist: 70, hip: 90, note: '' }
            ]));
        }, [MEASURE_KEY, localDate(daysAgo(14))]);
        await page.reload();

        await fillEntry(page, { weight: 49.5, waist: 68, hip: 91 });
        await expect(page.locator('#measureRows tr')).toHaveCount(2);
        // Newest first: it is 14 days after the first entry, so week 3.
        await expect(page.locator('#measureRows tr').first()).toContainText('สัปดาห์ที่ 3');
        await expect(page.locator('#measureSummary')).toContainText('-2 ซม. จากครั้งแรก');
        await expect(page.locator('#measureSummary')).toContainText('-0.5 กก. จากครั้งแรก');
    });

    test('rejects an entry with no measurements', async ({ page }) => {
        await fillEntry(page, { note: 'nothing measured' });
        await expect(page.locator('#measureError')).toBeVisible();
        await expect(page.locator('#measureRows tr')).toHaveCount(1); // the empty-state row
        expect(await page.evaluate(k => localStorage.getItem(k), MEASURE_KEY)).toBeNull();
    });

    test('renders notes as text, not HTML', async ({ page }) => {
        await fillEntry(page, { weight: 50, note: '<img src=x onerror="window.__xss=1">' });
        await expect(page.locator('#measureRows td').nth(5)).toHaveText('<img src=x onerror="window.__xss=1">');
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('deletes an entry and persists the deletion', async ({ page }) => {
        await fillEntry(page, { weight: 50 });
        await page.locator('#measureRows button[title="ลบรายการนี้"]').click();
        await page.reload();
        await expect(page.locator('#measureRows')).toContainText('ยังไม่มีข้อมูล');
    });
});

test.describe('protein calculator', () => {
    test('aims for 1.6 g/kg within a 1.4–2.0 g/kg range, for 50 kg', async ({ page }) => {
        await expect(page.locator('#proteinResult')).toHaveText('80 กรัม');
        await expect(page.locator('#proteinRange')).toHaveText('ช่วงที่เหมาะ 70 – 100 กรัม');
    });

    test('updates when the weight changes', async ({ page }) => {
        await page.click('[data-nav=nutrition]');
        await page.fill('#proteinWeight', '60');
        await expect(page.locator('#proteinResult')).toHaveText('96 กรัม');
        await expect(page.locator('#proteinRange')).toHaveText('ช่วงที่เหมาะ 84 – 120 กรัม');
    });

    test('follows the latest recorded weight', async ({ page }) => {
        await page.click('[data-nav=progress]');
        await fillEntry(page, { weight: 55 });
        await expect(page.locator('#proteinResult')).toHaveText('88 กรัม');
    });
});

test.describe('progress persistence', () => {
    test('keeps plan length, day check-in and exercise tick across reloads', async ({ page }) => {
        await page.click('#planBtn-5');
        await page.evaluate(() => { toggleDayCheck('mon'); toggleExerciseDone('ex1'); });
        await page.reload();

        expect(await page.evaluate(() => currentPlanFreq)).toBe(5);
        expect(await page.evaluate(() => checkedDaysState.mon)).toBe(true);
        await expect(page.locator('#completedExercisesCount')).toHaveText('1');
    });

    test("clears exercise ticks from a previous day but keeps this week's check-ins", async ({ page }) => {
        await page.evaluate(([key, yesterday, monday]) => {
            localStorage.setItem(key, JSON.stringify({
                date: yesterday, week: monday, freq: 4, exDone: { ex1: true }, days: { mon: true }
            }));
        }, [PROGRESS_KEY, localDate(daysAgo(1)), mondayOfThisWeek()]);
        await page.reload();

        await expect(page.locator('#completedExercisesCount')).toHaveText('0');
        expect(await page.evaluate(() => checkedDaysState.mon)).toBe(true);
    });

    test('clears check-ins from a previous week', async ({ page }) => {
        await page.evaluate(([key, lastWeek]) => {
            localStorage.setItem(key, JSON.stringify({
                date: lastWeek, week: lastWeek, freq: 3, exDone: {}, days: { mon: true, tue: true }
            }));
        }, [PROGRESS_KEY, localDate(daysAgo(8))]);
        await page.reload();

        expect(await page.evaluate(() => Object.values(checkedDaysState).some(Boolean))).toBe(false);
        expect(await page.evaluate(() => currentPlanFreq)).toBe(3); // plan length is kept
    });

    test('survives corrupt storage', async ({ page }) => {
        await page.evaluate(([p, m]) => {
            localStorage.setItem(p, '{not json');
            localStorage.setItem(m, '{"not":"an array"}');
        }, [PROGRESS_KEY, MEASURE_KEY]);
        await page.reload();
        await expect(page.locator('#measureRows')).toContainText('ยังไม่มีข้อมูล');
        await expect(page.locator('#exerciseList > div')).toHaveCount(3);
    });
});

function mondayOfThisWeek() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localDate(d);
}
