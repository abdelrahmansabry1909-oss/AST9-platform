// Two production bugs reported by the owner on 2026-08-09.
//
// 1. The unread notification badge never cleared. `_renderRow` puts
//    `data-act="open"` on the row element itself, but `_render` looked it up
//    with `el.querySelector(...)`, which searches descendants only. That
//    returned null, setting `.onclick` on it threw, and the throw aborted the
//    whole forEach — so no row got an open handler, none got an archive
//    handler, nothing was ever marked read, and the badge stayed.
//
// 2. The reactivate dialog was `window.prompt`, the browser's own dialog. It
//    renders outside the page and cannot be themed, so it looked nothing like
//    the app. Replaced with a dialog built from the app's modal markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const notif = read('js/notificationsService.js');
const dashboard = read('js/dashboard.js');
const clients = read('js/clients.js');
const subscriptions = read('js/subscriptions.js');

test('a notification row binds its own click, not a descendant that does not exist', () => {
  // The attribute lives on the row element, so querySelector can never find it.
  assert.ok(
    /data-act="open"/.test(notif),
    'rows should still carry data-act="open" for styling/semantics'
  );
  assert.ok(
    !/querySelector\(\s*'\[data-act="open"\]'\s*\)/.test(notif),
    'binding must not use querySelector for an attribute on the element itself — it returns null and throws'
  );
  assert.ok(
    /el\.onclick\s*=/.test(notif),
    'the row itself must carry the open handler'
  );
});

test('the archive handler is bound defensively so one missing node cannot break the list', () => {
  assert.ok(
    /const archiveBtn = el\.querySelector\('\[data-act="archive"\]'\);\s*\n\s*if \(archiveBtn\)/.test(notif),
    'archive lookup must be null-checked; an unguarded throw here aborts binding for every row'
  );
});

test('opening a notification marks it read and refreshes the count', () => {
  assert.ok(/function _openRow[\s\S]{0,200}markRead\(/.test(notif), '_openRow must mark the row read');
  assert.ok(/async function markRead[\s\S]{0,300}await unreadCount\(\)/.test(notif),
    'markRead must refresh the unread count so the badge updates');
});

test('themed dialog helpers exist and are exported', () => {
  assert.ok(/function _dialog\(/.test(dashboard), 'dashboard must define the themed dialog');
  assert.ok(/const askText\s*=/.test(dashboard) && /const askConfirm\s*=/.test(dashboard),
    'both askText and askConfirm must exist');
  assert.ok(/openModal, closeModal, askText, askConfirm/.test(dashboard),
    'the helpers must be exported on Dashboard');
});

test('the themed dialog is built from the app modal system, not invented markup', () => {
  const block = dashboard.slice(dashboard.indexOf('function _dialog('), dashboard.indexOf('const askConfirm'));
  for (const cls of ['modal-overlay', 'modal-header', 'modal-body', 'modal-footer']) {
    assert.ok(block.includes(cls), `dialog must use .${cls} so it inherits the real theme`);
  }
  assert.ok(/aria-modal="true"/.test(block), 'dialog must be an aria modal');
  assert.ok(/textContent =/.test(block), 'user-supplied strings must be set with textContent, not innerHTML');
});

test('the dialog resolves on cancel, Escape and backdrop, and cleans up', () => {
  const block = dashboard.slice(dashboard.indexOf('function _dialog('), dashboard.indexOf('const askConfirm'));
  assert.ok(/key === 'Escape'/.test(block), 'Escape must close the dialog');
  assert.ok(/e\.target === overlay/.test(block), 'a backdrop click must close the dialog');
  assert.ok(/overlay\.remove\(\)/.test(block), 'the dialog must be removed from the DOM when it closes');
  assert.ok(/removeEventListener\('keydown'/.test(block), 'the key handler must be torn down');
});

test('reactivate no longer uses a native browser dialog', () => {
  const reactivateClient = clients.slice(clients.indexOf('async function reactivateClient'));
  const body = reactivateClient.slice(0, reactivateClient.indexOf('\n  }'));
  assert.ok(!/window\.prompt|(?:^|[^.\w])prompt\(/.test(body),
    'reactivateClient must not call window.prompt — it cannot be themed');
  assert.ok(/Dashboard\.askText\(/.test(body), 'reactivateClient must use the themed dialog');

  const reactivate = subscriptions.slice(subscriptions.indexOf('async function reactivate'));
  const rbody = reactivate.slice(0, reactivate.indexOf('\n  }'));
  assert.ok(!/(?:^|[^.\w])confirm\(/.test(rbody), 'subscriptions reactivate must not call confirm');
  assert.ok(/Dashboard\.askConfirm\(/.test(rbody), 'subscriptions reactivate must use the themed dialog');
});

// ── The badge was showing the wrong number entirely ─────────────────
//
// Reported after the first fix: the red count still would not clear, and
// "Mark all read" appeared to do nothing. Those use different code paths, so a
// shared cause was implied — and the shared cause was that the visible badge
// was never a notification count.
//
// `stat-alerts` counts clients needing attention. `_setStat` copied it into
// `#topbar-badge-notifications`, so the bell displayed a client metric behind a
// notification icon. Reading or clearing notifications could not move it.
//
// Meanwhile the real badge was bound to `#notif-bell`, the sidebar bell, which
// is display:none above 901px unless the sidebar is hovered — so the number
// that did track unread was effectively invisible.
const appHtmlSrc = read('app.html');

test('the dashboard alerts KPI no longer drives the notification bell', () => {
  assert.ok(
    !/topbar-badge-notifications/.test(dashboard),
    'dashboard.js must not write to the notification badge — stat-alerts is a client metric, not an unread count'
  );
  assert.ok(
    /stat-alerts/.test(dashboard),
    'the alerts KPI itself should still exist; only the badge hijack was removed'
  );
});

test('the visible topbar bell is bound to the notification service', () => {
  assert.ok(
    /bindBell\(\s*\n?\s*document\.getElementById\('topbar-badge-notifications'\)\?\.closest/.test(appHtmlSrc),
    'the topbar bell must be bound — it is the one users can actually see'
  );
  assert.ok(
    /bindBell\(document\.getElementById\('notif-bell'\)\)/.test(appHtmlSrc),
    'the sidebar bell should stay bound too, for when the sidebar is expanded'
  );
});

test('bindBell reuses a badge the markup already provides', () => {
  assert.ok(
    /querySelector\('\.notif-badge, \.nc-topbar-badge'\)/.test(notif),
    'bindBell must adopt #topbar-badge-notifications rather than appending a second badge'
  );
});

test('the badge clears via the class, not only inline display', () => {
  // `.hidden` is `display:none !important`; an inline display cannot beat it,
  // so a badge that starts hidden would never appear, and one that starts
  // visible would never clear.
  assert.ok(
    /badge\.classList\.toggle\('hidden', _unread === 0\)/.test(notif),
    'the unread badge must toggle .hidden as well as inline display'
  );
});
