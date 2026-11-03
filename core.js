// Pure logic shared by the page and the unit tests (tests/unit). No DOM, no storage, no globals
// beyond what is declared here. Loaded by index.html as a classic script, so these names are
// page globals; in Node it exports them via module.exports at the bottom.

const DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

// ---------- Dates (local time, 'YYYY-MM-DD') ----------
function localDateStr(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mondayOfWeekStr(d = new Date()) {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return localDateStr(m);
}

function isValidIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00:00');
    return !isNaN(d) && localDateStr(d) === s;
}

// The 7 calendar dates (Mon..Sun) of the week containing `ref`.
function weekDates(ref = new Date()) {
    const [y, m, d] = mondayOfWeekStr(ref).split('-').map(Number);
    return DAY_IDS.map((_, i) => localDateStr(new Date(y, m - 1, d + i)));
}

// Whole days from the date `iso` to the calendar day of `now` (rounded, so DST days count as one).
function daysBetween(iso, now = new Date()) {
    const [y, m, d] = iso.split('-').map(Number);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - new Date(y, m - 1, d)) / 86400000);
}

function shortDate(iso) {
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// ---------- Check-ins and streaks ----------
// How many of `dates` are in the set of checked-in dates.
function countIn(dateSet, dates) {
    return dates.filter(d => dateSet.has(d)).length;
}

// Consecutive weeks with at least `minDays` check-ins, counting back from the week of `now`.
// The current week is still in progress, so it only adds to the streak once it qualifies.
function streakWeeks(dateSet, now = new Date(), minDays = 3) {
    const week = w => weekDates(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * w));
    let streak = countIn(dateSet, week(0)) >= minDays ? 1 : 0;
    for (let w = 1; countIn(dateSet, week(w)) >= minDays; w++) streak++;
    return streak;
}

// Exercise log { 'YYYY-MM-DD': [ids] }: keeps valid dates up to `today` and ids that `isKnown` accepts.
function cleanLogEntries(raw, isKnown, today = localDateStr()) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [date, ids] of Object.entries(raw)) {
        if (!isValidIsoDate(date) || date > today || !Array.isArray(ids)) continue;
        const known = [...new Set(ids.filter(id => typeof id === 'string' && isKnown(id)))];
        if (known.length) out[date] = known;
    }
    return out;
}

// ---------- Formatting ----------
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(v) { return v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toString(); }

function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Chart axis step: aim for about 3 intervals.
function niceStep(range) {
    const target = range / 3;
    for (const s of [0.5, 1, 2, 5, 10, 20]) if (s >= target) return s;
    return 50;
}

// ---------- Measurements: import and validation ----------
// Minimal CSV parser: quoted fields, "" escapes, CRLF/LF, optional BOM.
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') inQuotes = false;
            else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(f => f !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
}

// Returns a clean entry, or null if the record is unusable.
function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const date = typeof raw.date === 'string' ? raw.date.trim() : '';
    if (!isValidIsoDate(date)) return null;

    const num = (v, min, max) => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= min && n <= max ? n : undefined; // undefined = invalid
    };
    const weight = num(raw.weight, 20, 300), waist = num(raw.waist, 20, 250), hip = num(raw.hip, 20, 250);
    if (weight === undefined || waist === undefined || hip === undefined) return null;
    if (weight === null && waist === null && hip === null) return null;

    return {
        id: typeof raw.id === 'string' && /^[\w-]{1,32}$/.test(raw.id) ? raw.id : newId(),
        date, weight, waist, hip,
        note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 120) : ''
    };
}

// ---------- Weekly reminder (.ics calendar file) ----------
// iCalendar text: escape special characters, fold lines at 75 bytes without splitting a Thai character.
function icsText(s) {
    return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsFold(line) {
    const enc = new TextEncoder(), parts = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
        const b = enc.encode(ch).length;
        if (bytes + b > 75) { parts.push(cur); cur = ' ' + ch; bytes = 1 + b; }
        else { cur += ch; bytes += b; }
    }
    parts.push(cur);
    return parts.join('\r\n');
}

// Next date (today or later) on the chosen weekday (Mon = 0) at the chosen 'HH:MM'.
function nextReminderStart(dayIdx, time, now = new Date()) {
    const [h, m] = time.split(':').map(Number);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    let add = (dayIdx - (now.getDay() + 6) % 7 + 7) % 7;
    if (add === 0 && start <= now) add = 7;
    start.setDate(start.getDate() + add);
    return start;
}

// A weekly repeating event with an alert. `appUrl` is the link back to the Progress tab.
function buildReminderIcs({ day, time }, now = new Date(), appUrl = '') {
    const p = n => String(n).padStart(2, '0');
    const start = nextReminderStart(day, time, now);
    const local = `${start.getFullYear()}${p(start.getMonth() + 1)}${p(start.getDate())}T${p(start.getHours())}${p(start.getMinutes())}00`;
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hourglass Balance//Measurement reminder//TH', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        'UID:hourglass-measure-weekly@ninepth.github.io',
        `DTSTAMP:${stamp}`,
        `DTSTART:${local}`, // floating time: the phone's own time zone
        'DURATION:PT10M',
        `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[day]}`,
        `SUMMARY:${icsText('วัดสัดส่วน (เอว / สะโพก / น้ำหนัก)')}`,
        `DESCRIPTION:${icsText('เปิด Hourglass Balance แล้วบันทึกที่แท็บความคืบหน้า' + (appUrl ? '\n' + appUrl : ''))}`,
        ...(appUrl ? [`URL:${appUrl}`] : []),
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText('ถึงเวลาวัดสัดส่วนแล้ว')}`, 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(icsFold).join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DAY_IDS, ICS_DAYS, localDateStr, mondayOfWeekStr, isValidIsoDate, weekDates, daysBetween, shortDate,
        countIn, streakWeeks, cleanLogEntries, escapeHtml, fmt, formatTime, newId, niceStep,
        parseCsv, sanitizeEntry, icsText, icsFold, nextReminderStart, buildReminderIcs
    };
}
