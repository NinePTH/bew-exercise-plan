// Builds styles.css from the classes used in index.html: `npm run build:css`.
//
// Dark mode works by swapping colour values, not class names. Every palette colour the page uses is a
// CSS variable; in dark mode the light tints and dark inks trade places (rose-50 <-> rose-950, ...),
// so `bg-rose-50 text-rose-900` stays a soft tinted box with readable text in both themes.
// Grays get a hand-picked dark scale, and `surface` is the colour behind cards and inputs
// (white in light mode). `text-white` stays white in both themes.
const colors = require('tailwindcss/colors');

const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const ACCENTS = ['rose', 'pink', 'amber', 'emerald', 'indigo'];

const DARK_GRAY = {
    50: '#1d1d24', 100: '#26262e', 200: '#34343e', 300: '#4a4a55', 400: '#8b8b97', 500: '#a3a3ae',
    600: '#c2c2cb', 700: '#d6d6dd', 800: '#e7e7ec', 900: '#f3f3f6', 950: '#fafafb'
};

const rgb = hex => {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const mix = (a, b) => '#' + [0, 2, 4].map(i =>
    Math.round((parseInt(a.slice(1 + i, 3 + i), 16) + parseInt(b.slice(1 + i, 3 + i), 16)) / 2)
        .toString(16).padStart(2, '0')).join('');

// Dark value for each light step: mostly the mirror step, but the pale tints (100, 200) go a step
// deeper than a straight mirror so light ink (e.g. rose-600 -> rose-400) keeps 4.5:1 on hover tints.
function darkValue(name, step) {
    const c = colors[name];
    if (step === '100') return mix(c['900'], c['950']);
    if (step === '200') return c['900'];
    return c[STEPS[STEPS.length - 1 - STEPS.indexOf(step)]];
}

function vars(dark) {
    const out = {};
    for (const name of ACCENTS) {
        STEPS.forEach(step => {
            out[`--c-${name}-${step}`] = rgb(dark ? darkValue(name, step) : colors[name][step]);
        });
    }
    STEPS.forEach(step => { out[`--c-gray-${step}`] = rgb(dark ? DARK_GRAY[step] : colors.gray[step]); });
    out['--c-surface'] = dark ? rgb('#1b1b21') : rgb('#ffffff');
    return out;
}

const palette = name => Object.fromEntries(STEPS.map(s => [s, `rgb(var(--c-${name}-${s}) / <alpha-value>)`]));

module.exports = {
    content: ['./index.html'],
    theme: {
        extend: {
            colors: {
                ...Object.fromEntries([...ACCENTS, 'gray'].map(n => [n, palette(n)])),
                surface: 'rgb(var(--c-surface) / <alpha-value>)',
                // Filled buttons with white text. Fixed (not swapped in dark mode), so white text keeps
                // 4.5:1+ in both themes: rose-600/700 and amber-700/800.
                brand: {
                    DEFAULT: colors.rose['600'], dark: colors.rose['700'],
                    amber: colors.amber['700'], 'amber-dark': colors.amber['800']
                }
            }
        }
    },
    plugins: [
        function ({ addBase }) {
            addBase({
                ':root': vars(false),
                '@media (prefers-color-scheme: dark)': { ':root:not([data-theme="light"])': vars(true) },
                ':root[data-theme="dark"]': vars(true),
                // For areas that look the same in both themes, e.g. the gradient header.
                '.keep-light': vars(false)
            });
        }
    ]
};
