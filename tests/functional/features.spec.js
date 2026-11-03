const { test, expect } = require('@playwright/test');
const fs = require('fs');

const MEASURE_KEY = 'hg.measurements.v1';

function iso(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function seed(page, entries) {
    await page.goto('/index.html#progress');
    await page.evaluate(([key, list]) => localStorage.setItem(key, JSON.stringify(list)), [MEASURE_KEY, entries]);
    await page.reload();
}

const THREE_WEEKS = () => [
    { id: 'a', date: iso(14), weight: 51, waist: 71, hip: 90, note: '' },
    { id: 'b', date: iso(7), weight: 50.4, waist: 69.5, hip: 91, note: '' },
    { id: 'c', date: iso(0), weight: 50, waist: 68, hip: 92, note: '' }
];

test.describe('trend charts', () => {
    test('draws one chart per measure with at least two readings', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        await expect(page.locator('#measureCharts figure')).toHaveCount(3);
        for (const key of ['weight', 'waist', 'hip']) {
            await expect(page.locator(`[data-chart=${key}] polyline`)).toHaveCount(1);
            await expect(page.locator(`[data-chart=${key}] circle.chart-hit`)).toHaveCount(3);
        }
    });

    test('skips a measure that has fewer than two readings', async ({ page }) => {
        await seed(page, [
            { id: 'a', date: iso(7), weight: 50, waist: 70, hip: null, note: '' },
            { id: 'b', date: iso(0), weight: 49.5, waist: null, hip: null, note: '' }
        ]);
        await expect(page.locator('#measureCharts figure')).toHaveCount(1);
        await expect(page.locator('[data-chart=weight]')).toBeVisible();
    });

    test('asks for more data when there is nothing to plot', async ({ page }) => {
        await seed(page, [{ id: 'a', date: iso(0), weight: 50, waist: 68, hip: 92, note: '' }]);
        await expect(page.locator('#measureCharts figure')).toHaveCount(0);
        await expect(page.locator('#measureCharts')).toContainText('อย่างน้อย 2 ครั้ง');
    });

    test('hovering a point shows its date and value', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        const tip = page.locator('[data-chart=waist] .chart-tip');
        await expect(tip).toBeHidden();
        await page.locator('[data-chart=waist] circle.chart-hit').nth(1).hover();
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText(`${iso(7)} · 69.5 ซม.`);
        await page.mouse.move(0, 0);
        await expect(tip).toBeHidden();
    });

    test('a point can be reached by keyboard', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        await page.locator('[data-chart=weight] circle.chart-hit').first().focus();
        await expect(page.locator('[data-chart=weight] .chart-tip')).toHaveText(`${iso(14)} · 51 กก.`);
    });

    test('updates when a new entry is added', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        await page.fill('#mWeight', '49.8');
        await page.click('#measureForm button[type=submit]');
        await expect(page.locator('[data-chart=weight] circle.chart-hit')).toHaveCount(4);
    });
});

test.describe('change summary colours', () => {
    test('waist going down is green, but hips going up is not flagged red', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        const tone = label => page.locator('#measureSummary > div', { hasText: label }).locator('div').last();
        await expect(tone('รอบเอว')).toHaveClass(/text-emerald-600/);
        await expect(tone('รอบสะโพก')).not.toHaveClass(/text-rose-600|text-emerald-600/);
    });
});

test.describe('backup and restore', () => {
    test('exports every entry as JSON', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
        expect(download.suggestedFilename()).toMatch(/^hourglass-backup-\d{4}-\d{2}-\d{2}\.json$/);
        const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        expect(data.app).toBe('hourglass-balance');
        expect(data.measurements).toHaveLength(3);
        expect(data.measurements[2]).toMatchObject({ weight: 50, waist: 68, hip: 92 });
    });

    test('a backup restores onto an empty browser', async ({ page, browser }) => {
        await seed(page, THREE_WEEKS());
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportJsonBtn')]);
        const buffer = fs.readFileSync(await download.path());

        const fresh = await (await browser.newContext()).newPage();
        await fresh.goto('/index.html#progress');
        await fresh.setInputFiles('#importFile', { name: 'backup.json', mimeType: 'application/json', buffer });
        await expect(fresh.locator('#backupMsg')).toContainText('นำเข้า 3 รายการ');
        await expect(fresh.locator('#measureRows tr')).toHaveCount(3);
        await fresh.reload();
        await expect(fresh.locator('#measureRows tr')).toHaveCount(3);
    });

    test('the CSV export can be imported back', async ({ page, browser }) => {
        await seed(page, [...THREE_WEEKS(), { id: 'd', date: iso(1), weight: 50, waist: null, hip: null, note: 'มี "เครื่องหมายคำพูด", และจุลภาค' }]);
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=ส่งออก CSV')]);
        const buffer = fs.readFileSync(await download.path());

        const fresh = await (await browser.newContext()).newPage();
        await fresh.goto('/index.html#progress');
        await fresh.setInputFiles('#importFile', { name: 'body-measurements.csv', mimeType: 'text/csv', buffer });
        await expect(fresh.locator('#backupMsg')).toContainText('นำเข้า 4 รายการ');
        await expect(fresh.locator('#measureRows')).toContainText('มี "เครื่องหมายคำพูด", และจุลภาค');
    });

    test('importing the same file twice adds nothing the second time', async ({ page }) => {
        await seed(page, THREE_WEEKS());
        const buffer = Buffer.from(JSON.stringify({ measurements: THREE_WEEKS() }));
        await page.setInputFiles('#importFile', { name: 'again.json', mimeType: 'application/json', buffer });
        await expect(page.locator('#backupMsg')).toContainText('นำเข้า 0 รายการ');
        await expect(page.locator('#measureRows tr')).toHaveCount(3);
    });

    test('skips invalid records but keeps the valid ones', async ({ page }) => {
        await page.goto('/index.html#progress');
        const bad = [
            { date: iso(3), weight: 50, waist: 68, hip: 92, note: 'ok' },
            { date: 'not-a-date', weight: 50 },
            { date: '2026-02-30', weight: 50 },
            { date: iso(2), weight: 5000 },
            { date: iso(1) },
            'nonsense'
        ];
        await page.setInputFiles('#importFile', { name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
        await expect(page.locator('#backupMsg')).toContainText('นำเข้า 1 รายการ (ข้าม 5');
        await expect(page.locator('#measureRows tr')).toHaveCount(1);
    });

    test('rejects a file that is not a backup', async ({ page }) => {
        await page.goto('/index.html#progress');
        await page.setInputFiles('#importFile', { name: 'oops.json', mimeType: 'application/json', buffer: Buffer.from('not json at all') });
        await expect(page.locator('#backupMsg')).toContainText('นำเข้าไม่สำเร็จ');
        await page.setInputFiles('#importFile', { name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
        await expect(page.locator('#backupMsg')).toContainText('รูปแบบไฟล์ไม่ถูกต้อง');
        await expect(page.locator('#measureRows')).toContainText('ยังไม่มีข้อมูล');
    });

    test('imported notes are shown as text, never HTML', async ({ page }) => {
        await page.goto('/index.html#progress');
        const buffer = Buffer.from(JSON.stringify([{ date: iso(0), weight: 50, note: '<img src=x onerror="window.__xss=1">' }]));
        await page.setInputFiles('#importFile', { name: 'xss.json', mimeType: 'application/json', buffer });
        await expect(page.locator('#measureRows td').nth(5)).toHaveText('<img src=x onerror="window.__xss=1">');
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });
});

test.describe('meal plan', () => {
    test('shows four meals and a total on the nutrition tab only', async ({ page }) => {
        await page.goto('/index.html');
        await expect(page.locator('#mealPlanSection')).toBeHidden();
        await page.click('[data-nav=nutrition]');
        await expect(page.locator('#mealPlanSection')).toBeVisible();
        await expect(page.locator('#mealPlanSection tbody tr')).toHaveCount(4);
        await expect(page.locator('#mealPlanSection tfoot')).toContainText('~70–90 กรัม');
    });
});

test.describe('installable / offline', () => {
    test('links a manifest whose icons exist', async ({ page, request }) => {
        await page.goto('/index.html');
        const href = await page.locator('link[rel=manifest]').getAttribute('href');
        const manifest = await (await request.get('/' + href)).json();
        expect(manifest.display).toBe('standalone');
        expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
        for (const icon of manifest.icons) {
            const res = await request.get('/' + icon.src);
            expect(res.status(), icon.src).toBe(200);
        }
        const favicon = await page.locator('link[rel=icon]').getAttribute('href');
        expect((await request.get('/' + favicon)).status()).toBe(200);
    });

    test('keeps working after the network goes away', async ({ page, context }) => {
        await page.goto('/index.html');
        await page.evaluate(() => navigator.serviceWorker.ready);
        await context.setOffline(true);
        await page.reload();
        await expect(page.locator('h1')).toHaveText('Hourglass & Core Sculpt');
        // Styling still applies, i.e. the Tailwind script came from the offline cache.
        await expect(page.locator('h1')).toHaveCSS('font-size', '30px');
        await page.click('[data-nav=progress]');
        await page.fill('#mWeight', '50');
        await page.click('#measureForm button[type=submit]');
        await expect(page.locator('#measureRows tr')).toHaveCount(1);
        await context.setOffline(false);
    });
});
