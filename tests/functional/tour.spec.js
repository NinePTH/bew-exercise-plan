const { test, expect } = require('@playwright/test');

// These start as a brand-new visitor: nothing saved, tour not seen.
test.use({ storageState: { cookies: [], origins: [] } });

const WED = new Date(2026, 10, 4, 10, 0, 0);
const TOTAL = 11;
const card = page => page.locator('#tourCard');
const next = page => page.locator('#tourNext');
const count = page => page.locator('#tourCount');

async function rect(locator) {
    return locator.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }; });
}

// The card is shown only once the spotlight and the page have stopped moving.
async function settled(page) {
    await expect(card(page)).not.toHaveClass(/tour-card-hidden/);
}

// The spotlight's box surrounds every target's box.
async function expectSpotlightOn(page, ...targets) {
    await expect(async () => {
        const s = await rect(page.locator('#tourSpot'));
        for (const target of targets) {
            const t = await rect(target);
            expect(s.top).toBeLessThanOrEqual(t.top + 1);
            expect(s.left).toBeLessThanOrEqual(t.left + 1);
            expect(s.bottom).toBeGreaterThanOrEqual(t.bottom - 1);
            expect(s.right).toBeGreaterThanOrEqual(t.right - 1);
        }
    }).toPass({ timeout: 3000 });
}

// Every step: which tab it is on and what it spotlights.
const STEPS = [
    { tab: 'workout', title: 'ทุกอย่างอยู่ใน 3 แท็บ', targets: p => [p.locator('#sectionNav')] },
    { tab: 'workout', title: 'เลือกแพลนที่ทำไหว', targets: p => [p.locator('#planBtn-3'), p.locator('#planBtn-5')] },
    { tab: 'workout', title: 'ซ้อมเสร็จ เช็กชื่อวันนี้', targets: p => [p.locator('#dayTrackerContainer > div').nth(2)] }, // Wednesday
    { tab: 'workout', title: 'เวลาน้อยก็ยังซ้อมได้', targets: p => [p.locator('#programTabs')] },
    { tab: 'workout', title: 'ทำท่าไหนเสร็จ กดเช็กไว้', targets: p => [p.locator('#exerciseList > div').first().getByRole('button', { name: /ทำเสร็จแล้ว/ })] },
    { tab: 'workout', title: 'ตัวช่วยระหว่างซ้อม', targets: p => [p.locator('#timerDisplay'), p.locator('#startPauseBtn')] },
    { tab: 'progress', title: 'ดูความสม่ำเสมอของตัวเอง', targets: p => [p.locator('#statWeek')] },
    { tab: 'progress', title: 'วัดสัดส่วนสัปดาห์ละครั้ง', targets: p => [p.locator('#remIcsBtn'), p.locator('#measureForm')] },
    { tab: 'progress', title: 'ข้อมูลอยู่ในเครื่องนี้เท่านั้น', targets: p => [p.locator('#exportJsonBtn'), p.locator('#importBtn')] },
    { tab: 'nutrition', title: 'โปรตีนต่อวันของคุณ', targets: p => [p.locator('#proteinWeight'), p.locator('#proteinResult')] },
    { tab: 'nutrition', title: 'ปรับให้เข้ากับคุณ', targets: p => [p.locator('#themeBtn'), p.locator('#helpBtn')] }
];

test.describe('first-run tour', () => {
    test('opens by itself on a first visit, on the tab bar, with focus on Next', async ({ page }) => {
        await page.goto('/');
        await expect(card(page)).toBeVisible();
        await expect(page.locator('#tourTitle')).toHaveText(STEPS[0].title);
        await expect(count(page)).toHaveText(`1 / ${TOTAL}`);
        await expect(page.locator('#tourBack')).toBeHidden();
        await expect(next(page)).toBeFocused();
        await settled(page);
        await expectSpotlightOn(page, page.locator('#sectionNav'));
    });

    test('walks every step on the real controls of the right tab, then never opens again', async ({ page }) => {
        await page.clock.install({ time: WED });
        await page.goto('/');
        for (const [i, step] of STEPS.entries()) {
            await expect(count(page)).toHaveText(`${i + 1} / ${TOTAL}`);
            await expect(page.locator('#tourTitle')).toHaveText(step.title);
            await expect(page).toHaveURL(new RegExp(`#${step.tab}$`));
            await settled(page);
            await expectSpotlightOn(page, ...step.targets(page));
            const last = i === STEPS.length - 1;
            await expect(page.locator('#tourSkip')).toBeVisible({ visible: !last });
            await expect(next(page)).toHaveText(last ? 'เริ่มใช้งาน' : 'ถัดไป');
            await next(page).click();
        }
        await expect(page.locator('#tour')).toBeHidden();
        await expect(page).toHaveURL(/#workout$/); // back where they started
        await page.reload();
        await expect(page.locator('#tour')).toBeHidden();
    });

    test('moving to another tab: the spotlight glides straight there and never leaves the screen', async ({ page }) => {
        await page.goto('/');
        for (let i = 0; i < 5; i++) { await settled(page); await next(page).click(); }
        await settled(page); // step 6, at the bottom of the workout tab
        const frames = await page.evaluate(() => new Promise(done => {
            const log = [], t0 = performance.now();
            const rec = () => {
                const s = document.getElementById('tourSpot').getBoundingClientRect();
                log.push({ top: s.top, bottom: s.bottom, hidden: document.getElementById('tourCard').classList.contains('tour-card-hidden') });
                if (performance.now() - t0 < 1200) requestAnimationFrame(rec); else done(log);
            };
            document.getElementById('tourNext').click(); // to step 7, on the progress tab
            requestAnimationFrame(rec);
        }));
        const vh = page.viewportSize().height;
        let reversals = 0, dir = 0;
        for (let i = 1; i < frames.length; i++) {
            expect(frames[i].top, `frame ${i}`).toBeGreaterThanOrEqual(0);
            expect(frames[i].bottom, `frame ${i}`).toBeLessThanOrEqual(vh);
            const d = frames[i].top - frames[i - 1].top;
            if (Math.abs(d) > 0.5) { if (dir && Math.sign(d) !== dir) reversals++; dir = Math.sign(d); }
        }
        expect(reversals, 'the spotlight changes direction mid-glide').toBe(0);
        expect(frames[0].hidden, 'the card hides while moving').toBe(true);
        expect(frames.at(-1).hidden, 'the card comes back once settled').toBe(false);
    });

    test('skip closes it for good', async ({ page }) => {
        await page.goto('/');
        await page.locator('#tourSkip').click();
        await expect(page.locator('#tour')).toBeHidden();
        await page.reload();
        await expect(page.locator('#tour')).toBeHidden();
    });

    test('keyboard: arrows move between steps; Escape closes even with focus on the page', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('ArrowRight');
        await expect(count(page)).toHaveText(`2 / ${TOTAL}`);
        await page.keyboard.press('ArrowLeft');
        await expect(count(page)).toHaveText(`1 / ${TOTAL}`);
        await page.locator('#planBtn-4').focus(); // trying something on the page underneath
        await page.keyboard.press('Escape');
        await expect(page.locator('#tour')).toBeHidden();
    });

    test('back returns to the previous step', async ({ page }) => {
        await page.goto('/');
        await next(page).click();
        await next(page).click();
        await page.locator('#tourBack').click();
        await expect(count(page)).toHaveText(`2 / ${TOTAL}`);
    });

    test('the page stays usable underneath: the highlighted button works', async ({ page }) => {
        await page.goto('/');
        await next(page).click();
        await settled(page);
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
        await expect(count(page)).toHaveText(`1 / ${TOTAL}`);
        await page.keyboard.press('Escape');
        await expect(page.locator('#helpBtn')).toBeFocused();
    });

    test('"วิธีใช้" on another tab starts with that tab, Back still reaches earlier steps, and closing returns there', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('Escape');

        await page.locator('[data-nav=progress]').click();
        await page.locator('#helpBtn').click();
        await expect(count(page)).toHaveText(`7 / ${TOTAL}`);
        await expect(page.locator('#tourTitle')).toHaveText('ดูความสม่ำเสมอของตัวเอง');
        await page.keyboard.press('Escape');

        await page.locator('[data-nav=nutrition]').click();
        await page.locator('#helpBtn').click();
        await expect(count(page)).toHaveText(`10 / ${TOTAL}`);
        await page.locator('#tourBack').click();
        await expect(count(page)).toHaveText(`9 / ${TOTAL}`);
        await expect(page).toHaveURL(/#progress$/);
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#nutrition$/);
        await expect(page.locator('#nutritionSection')).toBeVisible();
    });

    test('closing puts the page back where it was scrolled to', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('Escape');
        await page.locator('#vacuumBtn').scrollIntoViewIfNeeded();
        const before = await page.evaluate(() => scrollY);
        expect(before).toBeGreaterThan(300);
        await page.evaluate(() => startTour()); // same as the header button, without scrolling up to it
        await settled(page);
        await next(page).click();
        await settled(page);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(Math.round(before));
    });

    test('with reduced motion the spotlight and the page jump instead of gliding', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');
        for (let i = 0; i < 4; i++) { await settled(page); await next(page).click(); }
        await settled(page); // step 5, then on to step 6 further down the same tab
        const frames = await page.evaluate(() => new Promise(done => {
            const log = [];
            const rec = () => {
                const s = document.getElementById('tourSpot').getBoundingClientRect();
                log.push({ top: Math.round(s.top), height: Math.round(s.height), y: Math.round(scrollY) });
                if (log.length < 15) requestAnimationFrame(rec); else done(log);
            };
            document.getElementById('tourNext').click();
            requestAnimationFrame(rec);
        }));
        // From the very first frame it is already where it ends up: no in-between positions.
        for (const f of frames) expect(f).toEqual(frames.at(-1));
        await expectSpotlightOn(page, ...STEPS[5].targets(page));
    });

    test('a fast Next then Back lands back on the earlier step, with no leftover scroll', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 }); // where step 5 → 6 is a long smooth scroll
        await page.goto('/');
        for (let i = 0; i < 4; i++) { await settled(page); await next(page).click(); }
        await settled(page); // step 5
        await page.evaluate(() => {
            for (const key of ['ArrowRight', 'ArrowLeft']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        });
        await expect(count(page)).toHaveText(`5 / ${TOTAL}`);
        await settled(page);
        await page.waitForTimeout(800); // any smooth scroll left over from step 6 would have moved the page by now
        await expectSpotlightOn(page, ...STEPS[4].targets(page));
        const s = await rect(page.locator('#tourSpot'));
        expect(s.top).toBeGreaterThanOrEqual(0);
        expect(s.bottom).toBeLessThanOrEqual(page.viewportSize().height);
    });

    test('while it moves, the card is out of reach (inert); once shown, Next has focus again', async ({ page }) => {
        await page.goto('/');
        await settled(page);
        const inertWhileMoving = await page.evaluate(() => { document.getElementById('tourNext').click(); return document.getElementById('tourCard').inert; });
        expect(inertWhileMoving).toBe(true);
        await settled(page);
        expect(await card(page).evaluate(el => el.inert)).toBe(false);
        await expect(next(page)).toBeFocused();
    });

    test('arrow keys in a form field type, they do not flip steps', async ({ page }) => {
        await page.goto('/');
        await settled(page);
        await page.locator('#tourNext').click();
        await settled(page);
        const before = await count(page).textContent();
        await page.locator('[data-nav=progress]').click(); // the page stays usable
        await page.locator('#mNote').fill('abc');
        await page.locator('#mNote').press('ArrowLeft');
        await expect(count(page)).toHaveText(before);
    });
});

for (const { name, width, height } of [{ name: 'a phone', width: 390, height: 844 }, { name: 'a small phone', width: 375, height: 667 }]) test.describe(`first-run tour on ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test('every step keeps the card on screen, above the tab bar, and off the highlighted control', async ({ page }) => {
        await page.clock.install({ time: WED });
        await page.goto('/');
        for (let step = 1; step <= TOTAL; step++) {
            await expect(count(page)).toHaveText(`${step} / ${TOTAL}`);
            await settled(page);
            await expect(async () => {
                const c = await rect(card(page)), s = await rect(page.locator('#tourSpot')), nav = await rect(page.locator('#sectionNav'));
                expect(c.left).toBeGreaterThanOrEqual(0);
                expect(c.right).toBeLessThanOrEqual(width);
                expect(c.top).toBeGreaterThanOrEqual(0);
                expect(c.bottom).toBeLessThanOrEqual(nav.top);
                const overlaps = c.top < s.bottom && c.bottom > s.top;
                expect(overlaps, `card covers the spotlight on step ${step}`).toBe(false);
            }).toPass({ timeout: 3000 });
            if (step < TOTAL) await next(page).tap();
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
