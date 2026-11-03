const { test, expect } = require('@playwright/test');

// These start as a brand-new visitor: nothing saved, tour not seen.
test.use({ storageState: { cookies: [], origins: [] } });

const WED = new Date(2026, 10, 4, 10, 0, 0);
const card = page => page.locator('#tourCard');
const next = page => page.locator('#tourNext');

async function rect(locator) {
    return locator.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }; });
}

// The spotlight's box surrounds the target's box.
async function expectSpotlightOn(page, target) {
    await expect(async () => {
        const s = await rect(page.locator('#tourSpot')), t = await rect(target);
        expect(s.top).toBeLessThanOrEqual(t.top + 1);
        expect(s.left).toBeLessThanOrEqual(t.left + 1);
        expect(s.bottom).toBeGreaterThanOrEqual(t.bottom - 1);
        expect(s.right).toBeGreaterThanOrEqual(t.right - 1);
    }).toPass({ timeout: 3000 });
}

test.describe('first-run tour', () => {
    test('opens by itself on a first visit, on the plan picker, with focus on Next', async ({ page }) => {
        await page.goto('/');
        await expect(card(page)).toBeVisible();
        await expect(page.locator('#tourTitle')).toHaveText('เลือกแพลนที่ทำไหว');
        await expect(page.locator('#tourCount')).toHaveText('1 / 4');
        await expect(page.locator('#tourBack')).toBeHidden();
        await expect(next(page)).toBeFocused();
        await expectSpotlightOn(page, page.locator('#planBtn-3'));
    });

    test('walks through all four steps on the real controls, then never opens again', async ({ page }) => {
        await page.clock.install({ time: WED });
        await page.goto('/');
        await next(page).click();
        await expect(page.locator('#tourCount')).toHaveText('2 / 4');
        await expectSpotlightOn(page, page.locator('#exerciseList > div').first().getByRole('button', { name: /ทำเสร็จแล้ว/ }));

        await next(page).click();
        await expect(page.locator('#tourTitle')).toHaveText('ซ้อมเสร็จ เช็กชื่อวันนี้');
        await expectSpotlightOn(page, page.locator('#dayTrackerContainer > div').nth(2)); // Wednesday

        await next(page).click();
        await expect(page).toHaveURL(/#progress$/);
        await expect(page.locator('#tourTitle')).toHaveText('ข้อมูลอยู่ในเครื่องนี้เท่านั้น');
        await expect(page.locator('#tourSkip')).toBeHidden();
        await expect(next(page)).toHaveText('เริ่มใช้งาน');
        await expectSpotlightOn(page, page.locator('#exportJsonBtn'));

        await next(page).click();
        await expect(page.locator('#tour')).toBeHidden();
        await expect(page).toHaveURL(/#workout$/); // back where they started
        await page.reload();
        await expect(page.locator('#tour')).toBeHidden();
    });

    test('skip closes it for good', async ({ page }) => {
        await page.goto('/');
        await page.locator('#tourSkip').click();
        await expect(page.locator('#tour')).toBeHidden();
        await page.reload();
        await expect(page.locator('#tour')).toBeHidden();
    });

    test('keyboard: arrows move between steps, Escape closes', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#tourCount')).toHaveText('2 / 4');
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#tourCount')).toHaveText('1 / 4');
        await page.keyboard.press('Escape');
        await expect(page.locator('#tour')).toBeHidden();
    });

    test('back returns to the previous step', async ({ page }) => {
        await page.goto('/');
        await next(page).click();
        await next(page).click();
        await page.locator('#tourBack').click();
        await expect(page.locator('#tourCount')).toHaveText('2 / 4');
    });

    test('the page stays usable underneath: the highlighted button works', async ({ page }) => {
        await page.goto('/');
        await page.locator('#planBtn-5').click();
        await expect(page.locator('#planBtn-5')).toHaveClass(/bg-brand/);
        await expect(card(page)).toBeVisible();
    });

    test('someone who already has data never sees it', async ({ page }) => {
        await page.addInitScript(() => {
            if (!localStorage.getItem('hg.checkins.v1')) localStorage.setItem('hg.checkins.v1', JSON.stringify(['2026-11-02']));
        });
        await page.goto('/');
        await expect(page.locator('#tour')).toBeHidden();
        expect(await page.evaluate(() => localStorage.getItem('hg.tourSeen'))).toBe('1');
    });

    test('"วิธีใช้" replays it, and focus returns to that button afterwards', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('Escape');
        await page.locator('#helpBtn').click();
        await expect(page.locator('#tourCount')).toHaveText('1 / 4');
        await page.keyboard.press('Escape');
        await expect(page.locator('#helpBtn')).toBeFocused();
    });

    test('opening from another tab returns to that tab', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('Escape');
        await page.locator('[data-nav=nutrition]').click();
        await page.locator('#helpBtn').click();
        await expect(page).toHaveURL(/#workout$/);
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#nutrition$/);
        await expect(page.locator('#nutritionSection')).toBeVisible();
    });
});

test.describe('first-run tour on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('every step keeps the card on screen, above the tab bar, and off the highlighted control', async ({ page }) => {
        await page.clock.install({ time: WED });
        await page.goto('/');
        for (let step = 1; step <= 4; step++) {
            await expect(page.locator('#tourCount')).toHaveText(`${step} / 4`);
            await expect(async () => {
                const c = await rect(card(page)), s = await rect(page.locator('#tourSpot')), nav = await rect(page.locator('#sectionNav'));
                expect(c.left).toBeGreaterThanOrEqual(0);
                expect(c.right).toBeLessThanOrEqual(390);
                expect(c.top).toBeGreaterThanOrEqual(0);
                expect(c.bottom).toBeLessThanOrEqual(nav.top);
                const overlaps = c.top < s.bottom && c.bottom > s.top;
                expect(overlaps, `card covers the spotlight on step ${step}`).toBe(false);
            }).toPass({ timeout: 3000 });
            if (step < 4) await next(page).tap();
        }
        // The buttons are comfortable to tap.
        for (const id of ['#tourBack', '#tourNext']) {
            const box = await page.locator(id).boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(44);
        }
    });

    test('works in dark mode', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/');
        await expect(card(page)).toBeVisible();
        expect(await card(page).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(27, 27, 33)');
    });
});
