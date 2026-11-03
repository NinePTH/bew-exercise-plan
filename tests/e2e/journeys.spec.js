// End-to-end journeys: real user flows driven only through the UI (clicks, taps, typing, files).
// No calls into the app's internals. Time is pinned with Playwright's clock where days or weeks matter.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const WED_4_NOV = new Date(2026, 10, 4, 9, 0, 0);   // Wednesday 4 Nov 2026, 09:00
const WED_11_NOV = new Date(2026, 10, 11, 9, 0, 0);

const nav = (page, name) => page.locator(`[data-nav=${name}]`);
const doneButton = card => card.getByRole('button', { name: /ทำเสร็จแล้ว/ });

async function logMeasurement(page, { date, weight, waist, hip, note = '' }) {
    if (date) await page.fill('#mDate', date);
    await page.getByLabel('น้ำหนัก (กก.)').fill(String(weight));
    await page.getByLabel('รอบเอว (ซม.)').fill(String(waist));
    await page.getByLabel('รอบสะโพก (ซม.)').fill(String(hip));
    await page.getByLabel('หมายเหตุ / ความรู้สึก').fill(note);
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
}

test('a friend opens the link for the first time and follows the tour, doing each step for real', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.clock.install({ time: WED_4_NOV });
    await page.goto('/');

    const step = async (n, title) => {
        await expect(page.locator('#tourCount')).toHaveText(`${n} / 11`);
        await expect(page.locator('#tourTitle')).toHaveText(title);
        await expect(page.locator('#tourCard')).not.toHaveClass(/tour-card-hidden/); // settled
    };
    const next = () => page.locator('#tourNext').tap();

    // 1: the three tabs.
    await step(1, 'ทุกอย่างอยู่ใน 3 แท็บ');
    await next();

    // 2: pick the beginner plan right under the spotlight.
    await step(2, 'เลือกแพลนที่ทำไหว');
    await page.getByRole('button', { name: '3 วัน (เริ่มต้น)' }).tap();
    await next();

    // 3: check in for today.
    await step(3, 'ซ้อมเสร็จ เช็กชื่อวันนี้');
    await page.getByRole('button', { name: 'เช็กชื่อวันพุธ' }).tap();
    await next();

    // 4: short on time, so the quick programme.
    await step(4, 'เวลาน้อยก็ยังซ้อมได้');
    await page.locator('#tab-quick_busy').tap();
    await next();

    // 5: finish an exercise.
    await step(5, 'ทำท่าไหนเสร็จ กดเช็กไว้');
    await doneButton(page.locator('#exerciseList > div').first()).tap();
    await expect(page.locator('#completedExercisesCount')).toHaveText('1');
    await next();

    // 6: a 30-second rest.
    await step(6, 'ตัวช่วยระหว่างซ้อม');
    await page.getByRole('button', { name: '30 วิ', exact: true }).tap();
    await expect(page.locator('#timerDisplay')).toHaveText(/^00:(30|2\d)$/);
    await page.getByRole('button', { name: 'รีเซต' }).tap();
    await next();

    // 7: the check-in shows up in the stats.
    await step(7, 'ดูความสม่ำเสมอของตัวเอง');
    await expect(page).toHaveURL(/#progress$/);
    await expect(page.locator('#statWeek')).toContainText('1 / 3');
    await next();

    // 8: first measurement.
    await step(8, 'วัดสัดส่วนสัปดาห์ละครั้ง');
    await logMeasurement(page, { weight: 50, waist: 66, hip: 90, note: 'เริ่มต้น' });
    await expect(page.locator('#measureRows tr')).toHaveCount(1);
    await next();

    // 9: back up.
    await step(9, 'ข้อมูลอยู่ในเครื่องนี้เท่านั้น');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportJsonBtn').tap()]);
    expect(download.suggestedFilename()).toMatch(/^hourglass-backup-/);
    await next();

    // 10: protein target for her own weight.
    await step(10, 'โปรตีนต่อวันของคุณ');
    await expect(page).toHaveURL(/#nutrition$/);
    await page.locator('#proteinWeight').fill('55');
    await expect(page.locator('#proteinResult')).toHaveText('88 กรัม');
    await next();

    // 11: where the theme and the replay live; then start using the app.
    await step(11, 'ปรับให้เข้ากับคุณ');
    await expect(page.locator('#tourNext')).toHaveText('เริ่มใช้งาน');
    await next();
    await expect(page.locator('#tour')).toBeHidden();
    await expect(page).toHaveURL(/#workout$/);

    // Coming back later: no tour, everything kept.
    await page.reload();
    await expect(page.locator('#tour')).toBeHidden();
    await expect(page.getByRole('button', { name: 'เช็กชื่อวันพุธ' })).toHaveAttribute('aria-pressed', 'true');
    await ctx.close();
});

test('first two weeks: plan, train, check in, measure, get reminded, measure again', async ({ page }) => {
    await page.clock.install({ time: WED_4_NOV });
    await page.goto('/');

    // Pick the beginner plan. The planner opens on today (Wednesday).
    await page.getByRole('button', { name: '3 วัน (เริ่มต้น)' }).click();
    await expect(page.locator('#selectedDayBanner')).toContainText('วันพุธ');

    // Open today's workout from the planner and finish the first exercise.
    await page.getByRole('button', { name: /^วันพุธ:/ }).click();
    await expect(page.locator('#programBanner')).toContainText('เอวคอด');
    await doneButton(page.locator('#exerciseList > div').first()).click();
    await expect(page.locator('#completedExercisesCount')).toHaveText('1');

    // Check in for today.
    const checkWed = page.getByRole('button', { name: 'เช็กชื่อวันพุธ' });
    await checkWed.click();
    await expect(checkWed).toHaveAttribute('aria-pressed', 'true');

    // Progress shows the week and today's exercise.
    await nav(page, 'progress').click();
    await expect(page.locator('#statWeek')).toContainText('1 / 3');
    await expect(page.locator('#exerciseHistory')).toContainText('Core Deadbug');

    // First measurement: one point, so no trend chart yet.
    await logMeasurement(page, { weight: 50.4, waist: 70, hip: 91, note: 'เริ่มต้นโปรแกรม' });
    await expect(page.locator('#measureRows tr')).toHaveCount(1);
    await expect(page.locator('#measureRows')).toContainText('เริ่มต้นโปรแกรม');
    await expect(page.locator('#measureCharts')).toContainText('อย่างน้อย 2 ครั้ง');

    // Everything survives closing and reopening the app.
    await page.reload();
    await expect(page.locator('#measureRows tr')).toHaveCount(1);
    await expect(page.locator('#statTotal')).toContainText('1');

    // A week later: a fresh planner week, and a reminder to measure.
    await page.clock.setSystemTime(WED_11_NOV);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'เช็กชื่อวันพุธ' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#completedExercisesCount')).toHaveText('0');
    const banner = page.locator('#reminderBanner');
    await expect(banner).toContainText('วัดครั้งล่าสุด 7 วันก่อน');

    // Follow the reminder and measure again: now there are trends and a waist change.
    await banner.getByRole('link', { name: 'ไปบันทึก' }).click();
    await expect(page).toHaveURL(/#progress$/);
    await logMeasurement(page, { weight: 50.1, waist: 69, hip: 91.5 });
    await expect(page.locator('#measureRows tr').first()).toContainText('สัปดาห์ที่ 2');
    await expect(page.locator('#measureCharts figure')).toHaveCount(3);
    await expect(page.locator('#measureSummary')).toContainText('-1 ซม. จากครั้งแรก');
    await expect(page.locator('[data-day="2026-11-04"]')).toHaveClass(/bg-rose-500/); // last week's check-in kept

    await nav(page, 'workout').click();
    await expect(banner).toBeEmpty();
});

test('moving to a new phone: back up on one device, restore on another', async ({ browser }) => {
    // Old phone: build up some history.
    const oldCtx = await browser.newContext();
    const oldPhone = await oldCtx.newPage();
    await oldPhone.clock.install({ time: WED_4_NOV });
    await oldPhone.goto('/');
    await oldPhone.getByRole('button', { name: '5 วัน (ฟิตจัดเต็ม)' }).click();
    await oldPhone.getByRole('button', { name: 'เช็กชื่อวันจันทร์' }).click();
    await oldPhone.getByRole('button', { name: 'เช็กชื่อวันพุธ' }).click();
    await doneButton(oldPhone.locator('#exerciseList > div').first()).click();
    await nav(oldPhone, 'progress').click();
    await logMeasurement(oldPhone, { date: '2026-10-28', weight: 50.6, waist: 70.5, hip: 91 });
    await logMeasurement(oldPhone, { date: '2026-11-04', weight: 50.2, waist: 69.5, hip: 91.4, note: 'เอวลดแล้ว' });

    const [download] = await Promise.all([
        oldPhone.waitForEvent('download'),
        oldPhone.getByRole('button', { name: /สำรองข้อมูล/ }).click()
    ]);
    const backupPath = await download.path();
    expect(fs.statSync(backupPath).size).toBeGreaterThan(100);

    // New phone (small touch screen): restore from the file.
    const newCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const newPhone = await newCtx.newPage();
    await newPhone.clock.install({ time: WED_4_NOV });
    await newPhone.goto('/');
    await nav(newPhone, 'progress').tap();
    await expect(newPhone.locator('#measureRows')).toContainText('ยังไม่มีข้อมูล');

    const [chooser] = await Promise.all([
        newPhone.waitForEvent('filechooser'),
        newPhone.getByRole('button', { name: /นำเข้าข้อมูล/ }).tap()
    ]);
    await chooser.setFiles(backupPath);
    await expect(newPhone.locator('#backupMsg')).toContainText('นำเข้า 2 รายการ');

    // Everything came across.
    await expect(newPhone.locator('#measureRows tr')).toHaveCount(2);
    await expect(newPhone.locator('#measureRows')).toContainText('เอวลดแล้ว');
    await expect(newPhone.locator('#statWeek')).toContainText('2 / 5');
    await expect(newPhone.locator('#statExTotal')).toHaveText('1');
    await nav(newPhone, 'workout').tap();
    await expect(newPhone.getByRole('button', { name: 'เช็กชื่อวันจันทร์' })).toHaveAttribute('aria-pressed', 'true');
    await expect(newPhone.locator('#completedExercisesCount')).toHaveText('1');
    await expect(newPhone.locator('#planBtn-5')).toHaveClass(/bg-brand/);

    await oldCtx.close();
    await newCtx.close();
});

test('training offline: the installed app works with no signal and keeps what you log', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready); // the app is installed for offline use
    await page.reload();

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toHaveText('Hourglass & Core Sculpt');
    await expect(page.locator('h1')).toHaveCSS('font-size', '30px'); // styles came from the offline cache

    await doneButton(page.locator('#exerciseList > div').first()).click();
    await expect(page.locator('#completedExercisesCount')).toHaveText('1');
    await nav(page, 'progress').click();
    await logMeasurement(page, { weight: 50, waist: 68, hip: 92, note: 'ยิมไม่มีสัญญาณ' });
    await expect(page.locator('#measureRows tr')).toHaveCount(1);

    // Back online: nothing was lost.
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator('#measureRows')).toContainText('ยิมไม่มีสัญญาณ');
    await nav(page, 'workout').click();
    await expect(page.locator('#completedExercisesCount')).toHaveText('1');
});

test('on a phone in dark mode: every tab fits the screen and the theme can be switched', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    const pageBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await pageBg()).toBe('rgb(14, 14, 18)');

    for (const tab of ['workout', 'progress', 'nutrition']) {
        await nav(page, tab).tap();
        await expect(nav(page, tab)).toHaveAttribute('aria-current', 'page');
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        expect(fits, `${tab} has no sideways scroll`).toBe(true);
        const box = await page.locator('#sectionNav').boundingBox();
        expect(Math.round(box.y + box.height)).toBe(844); // tab bar pinned to the bottom
    }

    await page.getByRole('button', { name: /ธีม/ }).tap(); // auto -> light
    await expect(page.locator('#themeLabel')).toHaveText('สว่าง');
    expect(await pageBg()).toBe('rgb(253, 248, 246)');
    await page.reload();
    expect(await pageBg()).toBe('rgb(253, 248, 246)');
    await ctx.close();
});

test('resting between sets: start from an exercise card, pause, resume, finish', async ({ page }) => {
    await page.clock.install({ time: WED_4_NOV });
    await page.goto('/');

    await page.locator('#exerciseList > div').first().getByRole('button', { name: /พัก 60 วิ/ }).click();
    await expect(page.locator('#timerDisplay')).toHaveText('01:00');

    const startPause = page.locator('#startPauseBtn');
    await startPause.click();
    await expect(startPause).toContainText('หยุดชั่วคราว');
    await page.clock.fastForward('00:20');
    await expect(page.locator('#timerDisplay')).toHaveText('00:40');

    await startPause.click(); // pause
    await page.clock.fastForward('00:15');
    await expect(page.locator('#timerDisplay')).toHaveText('00:40');

    await startPause.click(); // resume
    await page.clock.fastForward('00:41');
    await expect(page.locator('#timerDisplay')).toHaveText('00:00');
    await expect(page.locator('#timerStatus')).toContainText('ครบเวลาแล้ว');
    await expect(startPause).toContainText('เริ่มจับเวลา');
});

test('setting up the weekly reminder in the phone calendar', async ({ page }) => {
    await page.clock.install({ time: WED_4_NOV });
    await page.goto('/');
    await nav(page, 'progress').click();
    await page.getByLabel('เตือนวัดสัดส่วนทุกวัน').selectOption({ label: 'อาทิตย์' });
    await page.getByLabel('เวลา', { exact: true }).fill('19:00');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /เพิ่มลงปฏิทิน/ }).click()
    ]);
    const ics = fs.readFileSync(await download.path(), 'utf8');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=SU');
    expect(ics).toContain('DTSTART:20261108T190000');
    await expect(page.locator('#reminderMsg')).toContainText('อาทิตย์');
});
