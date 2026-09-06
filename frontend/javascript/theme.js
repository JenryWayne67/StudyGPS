// frontend/javascript/theme.js
//
// Site-wide dark mode. Self-contained: injects its own dark-mode CSS
// (covering both common.css's custom properties and the raw Tailwind
// utility classes pages use directly, since Tailwind's CDN build has no
// build step to add a `dark:` variant to), reads/writes the user's
// preference against the real backend (source of truth), and injects a
// floating toggle control - so any page picks up dark mode by adding one
// script tag, no per-page markup changes required.
//
// Include this in <head>, ideally right after the Tailwind CDN <script>
// tag, so the theme is applied before first paint (a cached choice in
// localStorage is applied immediately; the DB is still consulted right
// after and wins if it disagrees - e.g. a different device already
// changed it).

(function () {
    const STORAGE_KEY = 'studygps_dark_mode';

    function applyTheme(isDark) {
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    // 1. Paint the last-known choice immediately, before the DB round trip,
    // so there's no flash of the wrong theme on reload.
    let cached = null;
    try {
        cached = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
        // Storage unavailable (private mode, blocked) - fall back to light
        // until/unless the DB fetch below succeeds.
    }
    if (cached === '1') applyTheme(true);
    else if (cached === '0') applyTheme(false);

    // 2. Inject the dark-mode stylesheet once, synchronously, so it's
    // ready the instant data-theme flips to "dark".
    const style = document.createElement('style');
    style.textContent = `
        /* --- common.css custom properties (covers every page that links
           common.css and uses var(--bg-app) etc.) --- */
        :root[data-theme="dark"] {
            --bg-app: #0f172a;
            --bg-card: #1e293b;
            --bg-sidebar: #1e293b;

            --border-subtle: #334155;
            --border-medium: #475569;

            --text-primary: #f1f5f9;
            --text-secondary: #cbd5e1;
            --text-muted: #64748b;

            --color-primary-light: #1e3a5f;
        }

        /* --- Raw Tailwind utility classes used directly in page markup.
           Higher specificity ([data-theme="dark"] + class) beats a bare
           Tailwind class regardless of stylesheet load order, so this
           works whether Tailwind's CDN stylesheet loads before or after
           this one. --- */
        [data-theme="dark"] body { background-color: #0f172a; color: #f1f5f9; }

        [data-theme="dark"] .bg-white { background-color: #1e293b !important; }
        [data-theme="dark"] .bg-slate-50 { background-color: #0f172a !important; }
        [data-theme="dark"] .bg-slate-100 { background-color: #1e293b !important; }
        [data-theme="dark"] .bg-slate-200 { background-color: #334155 !important; }
        [data-theme="dark"] .bg-slate-900 { background-color: #f1f5f9 !important; }

        /* Tailwind's slash-opacity variants (bg-white/70, bg-slate-50/50,
           ...) are their OWN classes - the plain .bg-white rule above
           never matches them, so without these they stayed near-white in
           dark mode. That's what made schedule.html's "Rest Day" and
           "Nothing scheduled yet" boxes render as bright panels with
           light text on them, i.e. effectively unreadable. The slash has
           to be escaped in a CSS selector. */
        [data-theme="dark"] .bg-white\\/70 { background-color: rgba(30, 41, 59, 0.7) !important; }
        [data-theme="dark"] .bg-white\\/60 { background-color: rgba(30, 41, 59, 0.6) !important; }
        [data-theme="dark"] .bg-slate-50\\/50 { background-color: rgba(15, 23, 42, 0.5) !important; }
        [data-theme="dark"] .bg-slate-50\\/70 { background-color: rgba(15, 23, 42, 0.7) !important; }
        [data-theme="dark"] .bg-slate-200\\/80 { background-color: rgba(51, 65, 85, 0.8) !important; }
        [data-theme="dark"] .bg-blue-50\\/10 { background-color: rgba(30, 58, 95, 0.25) !important; }
        [data-theme="dark"] .bg-blue-50\\/20 { background-color: rgba(30, 58, 95, 0.35) !important; }
        [data-theme="dark"] .bg-blue-50\\/40 { background-color: rgba(30, 58, 95, 0.5) !important; }
        [data-theme="dark"] .bg-emerald-50\\/20 { background-color: rgba(6, 78, 59, 0.35) !important; }
        [data-theme="dark"] .border-slate-200\\/80 { border-color: rgba(51, 65, 85, 0.8) !important; }
        [data-theme="dark"] .border-slate-200\\/60 { border-color: rgba(51, 65, 85, 0.6) !important; }

        /* Text scale, brightened one step relative to the naive
           light-mode mirror. The old mapping put .text-slate-400 (used
           across every page for times, dates, page ranges and other
           secondary metadata) at #64748b, which is only a 3.07:1 contrast
           ratio on a #1e293b card - under the 4.5:1 WCAG AA minimum for
           small text, and the main reason secondary text read as "barely
           visible" in dark mode. Every value below clears 5.7:1. */
        [data-theme="dark"] .text-slate-900 { color: #f8fafc !important; }
        [data-theme="dark"] .text-slate-800 { color: #f1f5f9 !important; }
        [data-theme="dark"] .text-slate-700 { color: #e2e8f0 !important; }
        [data-theme="dark"] .text-slate-600 { color: #cbd5e1 !important; }
        [data-theme="dark"] .text-slate-500 { color: #b6c2d2 !important; }
        [data-theme="dark"] .text-slate-400 { color: #94a3b8 !important; }
        [data-theme="dark"] .text-slate-300 { color: #94a3b8 !important; }

        [data-theme="dark"] .border-slate-100 { border-color: #334155 !important; }
        [data-theme="dark"] .border-slate-200 { border-color: #334155 !important; }
        [data-theme="dark"] .border-slate-300 { border-color: #475569 !important; }

        [data-theme="dark"] .bg-blue-50 { background-color: #1e3a5f !important; }
        [data-theme="dark"] .bg-blue-100 { background-color: #1e3a5f !important; }
        [data-theme="dark"] .bg-blue-200 { background-color: #1e40af !important; }
        [data-theme="dark"] .border-blue-100 { border-color: #1e40af !important; }
        [data-theme="dark"] .border-blue-200 { border-color: #1e40af !important; }
        [data-theme="dark"] .border-blue-300 { border-color: #1d4ed8 !important; }
        [data-theme="dark"] .border-blue-400 { border-color: #2563eb !important; }
        [data-theme="dark"] .border-blue-500 { border-color: #3b82f6 !important; }
        [data-theme="dark"] .border-blue-600 { border-color: #3b82f6 !important; }
        [data-theme="dark"] .text-blue-600 { color: #60a5fa !important; }
        [data-theme="dark"] .text-blue-700 { color: #93c5fd !important; }
        [data-theme="dark"] .text-blue-800 { color: #bfdbfe !important; }

        [data-theme="dark"] .bg-emerald-50 { background-color: #064e3b !important; }
        [data-theme="dark"] .bg-emerald-100 { background-color: #065f46 !important; }
        [data-theme="dark"] .border-emerald-100 { border-color: #047857 !important; }
        [data-theme="dark"] .border-emerald-200 { border-color: #047857 !important; }
        [data-theme="dark"] .text-emerald-600 { color: #34d399 !important; }
        [data-theme="dark"] .text-emerald-700 { color: #6ee7b7 !important; }
        [data-theme="dark"] .text-emerald-800 { color: #a7f3d0 !important; }
        [data-theme="dark"] .text-emerald-900 { color: #d1fae5 !important; }

        [data-theme="dark"] .bg-amber-100 { background-color: #78350f !important; }
        [data-theme="dark"] .text-amber-600 { color: #fbbf24 !important; }
        [data-theme="dark"] .text-amber-800 { color: #fde68a !important; }

        [data-theme="dark"] .bg-red-50 { background-color: #7f1d1d !important; }
        [data-theme="dark"] .border-red-100 { border-color: #b91c1c !important; }
        [data-theme="dark"] .border-red-200 { border-color: #b91c1c !important; }
        [data-theme="dark"] .text-red-600 { color: #f87171 !important; }
        [data-theme="dark"] .text-red-700 { color: #fca5a5 !important; }

        [data-theme="dark"] .bg-rose-50 { background-color: #881337 !important; }
        [data-theme="dark"] .border-rose-200 { border-color: #9f1239 !important; }
        [data-theme="dark"] .text-rose-600 { color: #fb7185 !important; }
        [data-theme="dark"] .text-rose-700 { color: #fda4af !important; }

        [data-theme="dark"] .text-cyan-600 { color: #22d3ee !important; }
        [data-theme="dark"] .text-purple-600 { color: #c4b5fd !important; }

        [data-theme="dark"] ::placeholder { color: #64748b !important; }
        [data-theme="dark"] input,
        [data-theme="dark"] select,
        [data-theme="dark"] textarea { color-scheme: dark; }

        /* Theme toggle control injected by this script */
        .theme-toggle-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 1000;
            width: 48px;
            height: 48px;
            border-radius: 9999px;
            border: 1px solid rgba(148, 163, 184, 0.35);
            background-color: var(--bg-card, #ffffff);
            color: var(--text-primary, #0f172a);
            box-shadow: 0 4px 12px rgba(0,0,0,0.12);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 20px;
            line-height: 1;
            transition: transform 0.15s ease;
        }
        .theme-toggle-btn:hover { transform: scale(1.06); }
        .theme-toggle-btn:active { transform: scale(0.96); }
        @media (max-width: 860px) {
            .theme-toggle-btn { bottom: 80px; }
        }
    `;
    document.head.appendChild(style);

    function isDarkNow() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function persistLocally(isDark) {
        try {
            localStorage.setItem(STORAGE_KEY, isDark ? '1' : '0');
        } catch (err) {
            // ignore - best effort only
        }
    }

    async function fetchServerPreference() {
        try {
            const res = await fetch('/api/preferences', { credentials: 'same-origin' });
            if (!res.ok) return; // not logged in yet (e.g. on /login) - keep local/default
            const data = await res.json();
            const isDark = !!data.dark_mode;
            applyTheme(isDark);
            persistLocally(isDark);
            updateToggleIcon();
        } catch (err) {
            // Offline / server not reachable - keep whatever's already applied.
        }
    }

    async function toggleTheme() {
        const next = !isDarkNow();
        applyTheme(next);
        persistLocally(next);
        updateToggleIcon();

        try {
            await fetch('/api/preferences', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dark_mode: next })
            });
        } catch (err) {
            // Best effort - the local choice still applies this session even
            // if it couldn't be saved to the account right now.
        }
    }

    let toggleBtn = null;

    function updateToggleIcon() {
        if (!toggleBtn) return;
        toggleBtn.textContent = isDarkNow() ? '☀️' : '🌙';
        toggleBtn.setAttribute('aria-label', isDarkNow() ? 'Switch to light mode' : 'Switch to dark mode');
        toggleBtn.title = toggleBtn.getAttribute('aria-label');
    }

    function injectToggleButton() {
        if (document.querySelector('.theme-toggle-btn')) return; // already present
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'theme-toggle-btn';
        toggleBtn.addEventListener('click', toggleTheme);
        document.body.appendChild(toggleBtn);
        updateToggleIcon();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectToggleButton);
    } else {
        injectToggleButton();
    }

    // Sync with the account's saved preference once the DOM (and any auth
    // cookie) is ready - this is the source of truth, so it can flip the
    // locally-cached guess if they disagree (e.g. changed on another device).
    fetchServerPreference();

    // Exposed for any page that wants to react to theme changes (e.g. a
    // chart library that needs re-rendering with new colors).
    window.StudyGPSTheme = { toggle: toggleTheme, isDark: isDarkNow };
})();
