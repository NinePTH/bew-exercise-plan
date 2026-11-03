// Unit tests for core.js (pure logic). Run: npm run test:unit
// Dates are local time, so each block pins a time zone: Bangkok (the user's, no DST) by default,
// New York where daylight saving matters.
process.env.TZ = 'Asia/Bangkok';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../core.js');

const d = (y, m, day, h = 12) => new Date(y, m - 1, day, h, 0, 0);

describe('dates', () => {
    test('localDateStr pads month and day', () => {
        assert.equal(core.localDateStr(d(2026, 3, 5)), '2026-03-05');
    });

    test('mondayOfWeekStr: Sunday belongs to the week that started the Monday before', () => {
        assert.equal(core.mondayOfWeekStr(d(2026, 11, 8)), '2026-11-02');
        assert.equal(core.mondayOfWeekStr(d(2026, 11, 2)), '2026-11-02');
    });

    test('mondayOfWeekStr crosses month and year boundaries', () => {
        assert.equal(core.mondayOfWeekStr(d(2026, 3, 1)), '2026-02-23');
        assert.equal(core.mondayOfWeekStr(d(2027, 1, 1)), '2026-12-28');
    });

    test('weekDates returns Mon..Sun, across the new year', () => {
        assert.deepEqual(core.weekDates(d(2027, 1, 1)),
            ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    });

    test('isValidIsoDate accepts real dates only', () => {
        assert.equal(core.isValidIsoDate('2026-11-04'), true);
        assert.equal(core.isValidIsoDate('2028-02-29'), true, 'leap year');
        assert.equal(core.isValidIsoDate('2026-02-29'), false, 'not a leap year');
        assert.equal(core.isValidIsoDate('2026-13-01'), false);
        assert.equal(core.isValidIsoDate('2026-04-31'), false);
        assert.equal(core.isValidIsoDate('20266-11-04'), false, 'mistyped 5-digit year');
        assert.equal(core.isValidIsoDate('2026-1-4'), false);
        assert.equal(core.isValidIsoDate(20261104), false);
        assert.equal(core.isValidIsoDate(null), false);
    });

    test('daysBetween counts calendar days, ignoring the time of day', () => {
        assert.equal(core.daysBetween('2026-11-04', d(2026, 11, 4, 23)), 0);
        assert.equal(core.daysBetween('2026-10-28', d(2026, 11, 4, 0)), 7);
        assert.equal(core.daysBetween('2026-12-30', d(2027, 1, 2)), 3);
    });

    test('daysBetween is not thrown off by a daylight-saving change', () => {
        process.env.TZ = 'America/New_York'; // clocks go forward on 8 Mar 2026
        try {
            assert.equal(core.daysBetween('2026-03-07', new Date(2026, 2, 9, 0, 30)), 2);
            assert.equal(core.daysBetween('2026-03-01', new Date(2026, 2, 8, 12)), 7);
        } finally {
            process.env.TZ = 'Asia/Bangkok';
        }
    });

    test('shortDate is DD/MM', () => {
        assert.equal(core.shortDate('2026-11-04'), '04/11');
    });
});

describe('check-ins and streaks', () => {
    const WED = d(2026, 11, 4);

    test('countIn counts only dates that are in the set', () => {
        const set = new Set(['2026-11-02', '2026-11-04', '2026-10-01']);
        assert.equal(core.countIn(set, core.weekDates(WED)), 2);
    });

    test('streak counts past weeks with 3+ days; this week adds once it qualifies', () => {
        const twoGood = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-29'];
        assert.equal(core.streakWeeks(new Set([...twoGood, '2026-11-02']), WED), 2);
        assert.equal(core.streakWeeks(new Set([...twoGood, '2026-11-02', '2026-11-03', '2026-11-04']), WED), 3);
    });

    test('a short week breaks the streak', () => {
        const set = new Set(['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-19', '2026-10-26', '2026-10-27', '2026-10-28']);
        assert.equal(core.streakWeeks(set, WED), 1);
    });

    test('no check-ins means no streak', () => {
        assert.equal(core.streakWeeks(new Set(), WED), 0);
    });

    test('the streak carries across the new year', () => {
        const set = new Set(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-28', '2026-12-31', '2027-01-02']);
        assert.equal(core.streakWeeks(set, d(2027, 1, 5)), 2);
    });

    test('minDays is configurable', () => {
        const set = new Set(['2026-10-26', '2026-10-27']);
        assert.equal(core.streakWeeks(set, WED, 2), 1);
        assert.equal(core.streakWeeks(set, WED, 3), 0);
    });

    test('cleanLogEntries keeps known exercises on valid past dates, de-duplicated', () => {
        const known = id => ['ex1', 'ex2'].includes(id);
        const out = core.cleanLogEntries({
            '2026-11-04': ['ex1', 'ex1', 'nope', 7],
            '2026-11-05': ['ex2'],            // future
            '2026-02-30': ['ex1'],            // invalid
            '2026-11-01': 'ex2',              // not a list
            '2026-11-02': ['nope']            // nothing known
        }, known, '2026-11-04');
        assert.deepEqual(out, { '2026-11-04': ['ex1'] });
    });

    test('cleanLogEntries rejects non-objects', () => {
        for (const bad of [null, undefined, [], 'x', 3]) assert.deepEqual(core.cleanLogEntries(bad, () => true), {});
    });
});

describe('formatting', () => {
    test('escapeHtml escapes every HTML-significant character', () => {
        assert.equal(core.escapeHtml(`<img src="x" onerror='a&b'>`), '&lt;img src=&quot;x&quot; onerror=&#39;a&amp;b&#39;&gt;');
        assert.equal(core.escapeHtml(5), '5');
    });

    test('fmt rounds to one decimal and shows a dash for missing values', () => {
        assert.equal(core.fmt(50), '50');
        assert.equal(core.fmt(50.25), '50.3');
        assert.equal(core.fmt(49.94), '49.9');
        assert.equal(core.fmt(null), '–');
        assert.equal(core.fmt(undefined), '–');
    });

    test('formatTime shows mm:ss', () => {
        assert.equal(core.formatTime(0), '00:00');
        assert.equal(core.formatTime(45), '00:45');
        assert.equal(core.formatTime(65), '01:05');
    });

    test('niceStep picks about three axis intervals', () => {
        assert.equal(core.niceStep(1), 0.5);
        assert.equal(core.niceStep(2.5), 1);
        assert.equal(core.niceStep(5), 2);
        assert.equal(core.niceStep(100), 50);
    });

    test('newId is short, URL-safe and unique', () => {
        const ids = new Set(Array.from({ length: 500 }, core.newId));
        assert.equal(ids.size, 500);
        for (const id of ids) assert.match(id, /^[a-z0-9]{6,20}$/);
    });
});

describe('CSV parsing', () => {
    test('plain rows', () => {
        assert.deepEqual(core.parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
    });

    test('quoted fields with commas, escaped quotes and new lines', () => {
        assert.deepEqual(core.parseCsv('note\n"มี ""คำพูด"", และจุลภาค"\n"two\nlines"'),
            [['note'], ['มี "คำพูด", และจุลภาค'], ['two\nlines']]);
    });

    test('CRLF line endings, BOM, blank lines and a trailing newline', () => {
        assert.deepEqual(core.parseCsv('﻿a,b\r\n\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
    });

    test('empty fields are kept in position', () => {
        assert.deepEqual(core.parseCsv('d,w,x\n2026-11-04,,92'), [['d', 'w', 'x'], ['2026-11-04', '', '92']]);
    });

    test('empty input gives no rows', () => {
        assert.deepEqual(core.parseCsv(''), []);
        assert.deepEqual(core.parseCsv('\n\n'), []);
    });
});

describe('measurement validation (sanitizeEntry)', () => {
    test('keeps a valid entry and its id', () => {
        assert.deepEqual(core.sanitizeEntry({ id: 'abc-1', date: '2026-11-04', weight: 50.2, waist: 68, hip: 92, note: ' hi ' }),
            { id: 'abc-1', date: '2026-11-04', weight: 50.2, waist: 68, hip: 92, note: 'hi' });
    });

    test('accepts numbers given as text (from CSV) and empty fields as missing', () => {
        assert.deepEqual(core.sanitizeEntry({ id: 'a', date: '2026-11-04', weight: '50.5', waist: '', hip: null }),
            { id: 'a', date: '2026-11-04', weight: 50.5, waist: null, hip: null, note: '' });
    });

    test('rejects impossible values and dates', () => {
        assert.equal(core.sanitizeEntry({ date: '2026-11-04', weight: 5000 }), null);
        assert.equal(core.sanitizeEntry({ date: '2026-11-04', waist: 10 }), null);
        assert.equal(core.sanitizeEntry({ date: '2026-11-04', hip: 'abc' }), null);
        assert.equal(core.sanitizeEntry({ date: '2026-02-30', weight: 50 }), null);
        assert.equal(core.sanitizeEntry({ date: '20266-11-04', weight: 50 }), null);
    });

    test('needs at least one measurement', () => {
        assert.equal(core.sanitizeEntry({ date: '2026-11-04', note: 'only a note' }), null);
    });

    test('rejects non-objects', () => {
        for (const bad of [null, undefined, 'x', 42]) assert.equal(core.sanitizeEntry(bad), null);
    });

    test('replaces unsafe ids and caps notes at 120 characters', () => {
        const e = core.sanitizeEntry({ id: `x');alert(1)//`, date: '2026-11-04', weight: 50, note: 'ก'.repeat(200) });
        assert.match(e.id, /^[\w-]+$/);
        assert.notEqual(e.id, `x');alert(1)//`);
        assert.equal(e.note.length, 120);
    });
});

describe('calendar reminder (.ics)', () => {
    test('icsText escapes backslashes, semicolons, commas and new lines', () => {
        assert.equal(core.icsText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
    });

    test('icsFold keeps every line within 75 bytes and never splits a Thai character', () => {
        const line = 'SUMMARY:' + 'วัดสัดส่วนเอวสะโพกน้ำหนัก'.repeat(6);
        const folded = core.icsFold(line);
        for (const part of folded.split('\r\n')) assert.ok(Buffer.byteLength(part) <= 75, part);
        assert.equal(folded.replace(/\r\n /g, ''), line, 'unfolding gives back the original');
        assert.ok(!folded.includes('�'));
    });

    test('a short line is left alone', () => {
        assert.equal(core.icsFold('VERSION:2.0'), 'VERSION:2.0');
    });

    test('nextReminderStart: later today, next week if passed, and other weekdays', () => {
        const now = d(2026, 11, 4, 10); // Wednesday 10:00
        assert.equal(core.localDateStr(core.nextReminderStart(2, '11:00', now)), '2026-11-04');
        assert.equal(core.localDateStr(core.nextReminderStart(2, '09:00', now)), '2026-11-11');
        assert.equal(core.localDateStr(core.nextReminderStart(0, '07:00', now)), '2026-11-09');
        assert.equal(core.localDateStr(core.nextReminderStart(6, '07:00', now)), '2026-11-08');
        const t = core.nextReminderStart(5, '08:30', now);
        assert.deepEqual([t.getHours(), t.getMinutes()], [8, 30]);
    });

    test('buildReminderIcs makes a weekly event with an alert, CRLF throughout', () => {
        const ics = core.buildReminderIcs({ day: 5, time: '08:30' }, d(2026, 11, 4, 10), 'https://example.org/app/index.html#progress');
        assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
        assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
        assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=SA\r\n'));
        assert.ok(ics.includes('DTSTART:20261107T083000\r\n'));
        assert.ok(ics.includes('BEGIN:VALARM\r\nACTION:DISPLAY'));
        assert.ok(ics.replace(/\r\n /g, '').includes('URL:https://example.org/app/index.html#progress'));
        assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF');
    });

    test('buildReminderIcs leaves out URL when no link is given', () => {
        const ics = core.buildReminderIcs({ day: 0, time: '07:00' }, d(2026, 11, 4, 10));
        assert.equal(ics.includes('URL:'), false);
        assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO'));
    });
});
