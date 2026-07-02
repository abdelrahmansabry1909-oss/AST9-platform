// ═══════════════════════════════════════════════════════════════
//  js/monitoring.js
//  P1E-3 — Inert frontend error-monitoring shell (Sentry, errors-only).
//
//  PRIVACY CONTRACT — do NOT weaken without owner + privacy review:
//    • INERT by default: no-ops unless window.SENTRY_DSN is a non-empty
//      string AND the pinned Sentry global loaded. Blank DSN ⇒ ZERO network.
//    • FAIL-OPEN: every path is wrapped so a missing / blocked / failed CDN,
//      an undefined Sentry, or an init error can NEVER break app boot.
//    • NO Session Replay, NO performance tracing, NO profiling (the pinned
//      bundle is errors-only, so that code is not even shipped).
//    • NO setUser; NO user / client id or email. Tags are limited to
//      { role, feature_area, app_version } and enforced in beforeSend.
//    • ALL breadcrumbs disabled (console/dom/fetch/xhr/history) via the
//      dropped integrations + maxBreadcrumbs:0 + beforeBreadcrumb → null.
//    • beforeSend scrubs every outbound event (redact THEN truncate) and
//      returns null if the scrubber itself throws — a scrubber bug must
//      NEVER leak a raw event.
//    • Reads NO localStorage / sessionStorage / cookies / Supabase session.
//
//  Server-side Sentry scrubbing (Prevent-Store-IP, sensitive fields,
//  Allowed Domains) is the REQUIRED second net; this client scrubber is
//  the first. Free-text human names in error strings are not regex-able —
//  the mitigation is the [[chore(logging)]] cleanup + Key/DETAIL scrubs.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // Keep in sync with the js/monitoring.js?v= token in app.html.
  var APP_VERSION = '20260702b';

  // ── envFromHost(): derive the Sentry environment from the hostname so
  //  localhost / preview builds never report as 'production' now the DSN
  //  is live. Fail-safe to 'preview' on any error. ──────────────────
  function envFromHost() {
    try {
      var h = (window.location && window.location.hostname) || '';
      if (h === 'abdelrahmansabry1909-oss.github.io') return 'production';
      if (h === 'localhost' || h === '127.0.0.1') return 'development';
      return 'preview';
    } catch (_e) { return 'preview'; }
  }

  // ── scrub(): redact sensitive substrings, THEN truncate ─────────
  //  Order matters — most specific patterns first so a broad rule never
  //  eats a token/uuid before its specific rule runs.
  function scrub(input) {
    if (input == null) return input;
    var s = String(input)
      // JWTs (eyJ… . … . …) and Bearer tokens
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [token]')
      // Supabase storage-key / token-looking values
      .replace(/sb-[A-Za-z0-9_-]+/g, '[token]')
      // explicit "key: value" / "key=value" secret forms
      .replace(/(access_token|refresh_token|api[_-]?key|apikey|authorization)("?\s*[:=]\s*"?)[A-Za-z0-9._~+/-]+=*/gi, '$1$2[redacted]')
      // emails
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      // UUID v1–v5
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[uuid]')
      // Postgres constraint echoes that embed row values
      .replace(/Key \([^)]*\)=\([^)]*\)/g, 'Key (…)=(…)')
      .replace(/(DETAIL|Detail|detail):\s*[^\n\r]*/g, '$1: [redacted]')
      // PostgREST filter markers  col=eq.<value>  (row ids leak here)
      .replace(/\b(eq|neq|gt|gte|lt|lte|like|ilike|in|is|cs|cd)\.[^\s&)"']+/gi, '$1.[filter]')
      // phone-number-ish runs (after uuid so uuid digits are already gone)
      .replace(/\+?\d[\d().\-\s]{7,}\d/g, '[phone]')
      // any remaining long digit run
      .replace(/\d{9,}/g, '[num]');
    if (s.length > 500) s = s.slice(0, 500) + '…';
    return s;
  }

  // ── stripUrl(): drop query + hash (Supabase puts tokens there:
  //     #access_token=…, ?code=…) ─────────────────────────────────
  function stripUrl(u) {
    return (u == null) ? u : String(u).split(/[?#]/)[0];
  }

  // ── beforeSend(): delete unsafe fields + scrub; fail-safe to null ─
  function beforeSend(event) {
    try {
      delete event.user;
      delete event.extra;
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.url) event.request.url = stripUrl(event.request.url);
      }
      if (event.contexts) {
        delete event.contexts.state;
        delete event.contexts.response;
      }
      // Allow-list tags to exactly { role, feature_area, app_version }.
      if (event.tags) {
        var t = {};
        if (event.tags.role !== undefined) t.role = event.tags.role;
        if (event.tags.feature_area !== undefined) t.feature_area = event.tags.feature_area;
        if (event.tags.app_version !== undefined) t.app_version = event.tags.app_version;
        event.tags = t;
      }
      // Scrub every exception value + every stack-frame URL, and the message.
      var values = (event.exception && event.exception.values) || [];
      for (var i = 0; i < values.length; i++) {
        var ex = values[i];
        if (!ex) continue;
        if (ex.value != null) ex.value = scrub(ex.value);
        var frames = (ex.stacktrace && ex.stacktrace.frames) || [];
        for (var f = 0; f < frames.length; f++) {
          var fr = frames[f];
          if (!fr) continue;
          if (fr.filename) fr.filename = stripUrl(fr.filename);
          if (fr.abs_path) fr.abs_path = stripUrl(fr.abs_path);
        }
      }
      if (event.message != null) event.message = scrub(event.message);
      event.breadcrumbs = [];
      return event;
    } catch (_e) {
      // A scrubber bug must never leak a raw event.
      return null;
    }
  }

  // ── init(): only runs when a DSN is present and Sentry loaded ────
  function init() {
    try {
      var dsn = window.SENTRY_DSN;
      if (!dsn || typeof dsn !== 'string') return;                       // inert ⇒ zero network
      var S = window.Sentry;
      if (!S || typeof S.init !== 'function') return;                    // CDN blocked/failed ⇒ no-op

      S.init({
        dsn: dsn,
        environment: envFromHost(),
        release: 'ast9-frontend@' + APP_VERSION,
        sendDefaultPii: false,
        sampleRate: 1.0,
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        maxBreadcrumbs: 0,
        // Errors-only: keep global error/rejection handlers; drop the
        // breadcrumb collector and the setTimeout/addEventListener wrapper.
        integrations: function (defaults) {
          return (defaults || []).filter(function (integration) {
            return integration &&
              integration.name !== 'Breadcrumbs' &&
              integration.name !== 'BrowserApiErrors';
          });
        },
        beforeBreadcrumb: function () { return null; },
        ignoreErrors: [
          'ResizeObserver loop limit exceeded',
          'ResizeObserver loop completed with undelivered notifications.',
          'NetworkError',
          'Failed to fetch',
          'Load failed',
          'Script error.',
          'Non-Error promise rejection captured',  // SDK ≤ v7 wording
          'Object captured as promise rejection'    // SDK v8+/v10 wording
        ],
        denyUrls: [
          /^chrome-extension:\/\//i,
          /^moz-extension:\/\//i,
          /^safari-extension:\/\//i,
          /^safari-web-extension:\/\//i
        ],
        beforeSend: beforeSend
      });

      // Coarse, non-identifying tags only. Never setUser.
      if (typeof S.setTag === 'function') {
        S.setTag('app_version', APP_VERSION);
        S.setTag('role', 'unknown');   // a later, separate hook may refine this
      }
    } catch (_e) {
      // Fail open — monitoring must never break boot.
    }
  }

  // ── captureIssue(area, code, context?): the only public helper ───
  //  Sends ONLY a generic message + the feature_area tag. Never sends the
  //  caught error object, ids, or non-scalar context. No call sites yet.
  function captureIssue(area, code, context) {
    try {
      var S = window.Sentry;
      if (!window.SENTRY_DSN || !S || typeof S.captureMessage !== 'function') return;
      var msg = '[' + String(area) + '] ' + String(code);
      if (context != null &&
          (typeof context === 'string' || typeof context === 'number' || typeof context === 'boolean')) {
        msg += ' | ' + String(context);       // scalar only; scrubbed by beforeSend
      }
      if (typeof S.withScope === 'function') {
        S.withScope(function (scope) {
          if (scope && typeof scope.setTag === 'function') {
            scope.setTag('feature_area', String(area).slice(0, 64));
          }
          S.captureMessage(msg, 'error');
        });
      } else {
        S.captureMessage(msg, 'error');
      }
    } catch (_e) {
      // Fail open.
    }
  }

  window.Monitoring = { captureIssue: captureIssue };

  init();
})();
