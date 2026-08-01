// tests/unit/subscription-write-rule.test.js
//
// Behavioral tests for the client subscription write rule. The same paid-access
// decision is implemented in browser JavaScript and in a PostgreSQL predicate;
// this file locks their agreement so either side cannot drift silently.
//
// The legacy browser script is evaluated in an isolated vm context. No Supabase
// service, network, database, or test-process global is used by these tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SERVICE_URL = new URL('../../js/subscriptionService.js', import.meta.url);
const WRITE_GATE_URL = new URL(
  '../../supabase/migrations/20260728010000_workout_write_subscription_gate.sql',
  import.meta.url,
);
const VIEW_URL = new URL(
  '../../supabase/migrations/20260530202308_subscription_grace.sql',
  import.meta.url,
);

const SERVICE_SOURCE = readFileSync(SERVICE_URL, 'utf8');
const WRITE_GATE_SQL = readFileSync(WRITE_GATE_URL, 'utf8');
const VIEW_SQL = readFileSync(VIEW_URL, 'utf8');
const SYSTEM_STATUSES = ['pending', 'expired', 'active', 'grace', 'none', 'unknown'];

function loadService({ sb, withSb = false } = {}) {
  const context = {
    window: {},
    console: { warn() {} },
  };
  if (withSb) context.sb = sb;
  vm.createContext(context);
  vm.runInContext(SERVICE_SOURCE, context, { filename: 'js/subscriptionService.js' });
  return context.window.SubscriptionService;
}

function sqlWriteStatuses(sql) {
  const functionBody = sql.match(
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.client_has_write_access\s*\([^)]*\)[\s\S]*?\bAS\s+\$\$([\s\S]*?)\$\$\s*;/i,
  );
  assert.ok(functionBody, 'client_has_write_access SQL function body must be present');

  const inList = functionBody[1].match(
    /\bSELECT\s+v\.effective_status\s+IN\s*\(\s*((?:'(?:''|[^'])*'\s*,\s*)*'(?:''|[^'])*')\s*\)/i,
  );
  assert.ok(inList, 'client_has_write_access must compare v.effective_status to a literal IN list');
  return [...inList[1].matchAll(/'((?:''|[^'])*)'/g)].map((match) =>
    match[1].replaceAll("''", "'"),
  );
}

function subscriptionQuery(result, { throws = false } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  if (throws) throw new Error('offline query failure');
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };
}

test('canWrite agrees exactly with the SQL write-status list', () => {
  const service = loadService();
  const sqlStatuses = sqlWriteStatuses(WRITE_GATE_SQL);
  const candidates = new Set([...SYSTEM_STATUSES, ...sqlStatuses]);

  // A status added to either implementation without the other must fail here.
  for (const status of candidates) {
    assert.equal(
      service.canWrite({ effective_status: status }),
      sqlStatuses.includes(status),
      `${status} must have the same write decision in JavaScript and SQL`,
    );
  }

  // The browser gate must never grant a system status absent from the SQL list.
  for (const status of SYSTEM_STATUSES.filter((status) => !sqlStatuses.includes(status))) {
    assert.equal(service.canWrite({ effective_status: status }), false);
  }
});

test('canWrite returns the exact decision across statuses and defensive inputs', () => {
  const { canWrite } = loadService();
  const cases = [
    [{ effective_status: 'active' }, true],
    [{ effective_status: 'grace' }, true],
    [{ effective_status: 'expired' }, false],
    [{ effective_status: 'pending' }, false],
    [{ effective_status: 'none' }, false],
    [{ effective_status: 'unknown' }, false],
    [null, false],
    [undefined, false],
    [{}, false],
    [{ unrelated: 'value' }, false],
    [{ effective_status: 'unrecognised' }, false],
  ];

  for (const [state, expected] of cases) {
    assert.equal(canWrite(state), expected, `unexpected write decision for ${JSON.stringify(state)}`);
  }
});

test('unknown fails closed for writes while a failed state read stays fail-soft', async () => {
  // These intentionally pull in opposite directions: a failed read denies writes,
  // but returns unknown rather than none so a valid client is not bounced out.
  const sb = subscriptionQuery({ data: null, error: { message: 'read failed' } });
  const service = loadService({ sb, withSb: true });
  const state = await service.getEffectiveState('client-id');

  assert.deepEqual({ ...state }, { effective_status: 'unknown', error: true });
  assert.notEqual(state.effective_status, 'none');
  assert.equal(service.canWrite(state), false);
});

test('getEffectiveState without sb returns the exact no-subscription shape', async () => {
  const state = await loadService().getEffectiveState('client-id');
  assert.deepEqual({ ...state }, { effective_status: 'none', sub_id: null });
});

test('getEffectiveState returns unknown when the subscription query reports an error', async () => {
  const sb = subscriptionQuery({ data: null, error: { message: 'read failed' } });
  const state = await loadService({ sb, withSb: true }).getEffectiveState('client-id');
  assert.deepEqual({ ...state }, { effective_status: 'unknown', error: true });
  assert.notEqual(state.effective_status, 'none');
});

test('getEffectiveState returns unknown when the subscription query throws', async () => {
  const sb = subscriptionQuery(null, { throws: true });
  const state = await loadService({ sb, withSb: true }).getEffectiveState('client-id');
  assert.deepEqual({ ...state }, { effective_status: 'unknown', error: true });
  assert.notEqual(state.effective_status, 'none');
});

test('formatPill locks day boundaries, status labels, and tones', () => {
  const { formatPill } = loadService();
  // Boundary cases enumerated before implementation: days_remaining 15, 14, 1,
  // 0, and negative; grace_days_left 1 and 2; then pending, expired, unknown,
  // none, and an unrecognised fallthrough. Every case locks label and tone.
  const cases = [
    [{ effective_status: 'active', days_remaining: 15 }, { label: 'Active · 15 days left', tone: 'teal' }],
    [{ effective_status: 'active', days_remaining: 14 }, { label: 'Active · 14 days left', tone: 'amber' }],
    [{ effective_status: 'active', days_remaining: 1 }, { label: 'Active · 1 days left', tone: 'amber' }],
    [{ effective_status: 'active', days_remaining: 0 }, { label: 'Active · ends today', tone: 'amber' }],
    [{ effective_status: 'active', days_remaining: -1 }, { label: 'Active · ends today', tone: 'amber' }],
    [{ effective_status: 'grace', grace_days_left: 1 }, { label: 'Grace · 1 day to renew', tone: 'rose' }],
    [{ effective_status: 'grace', grace_days_left: 2 }, { label: 'Grace · 2 days to renew', tone: 'rose' }],
    [{ effective_status: 'pending' }, { label: 'Pending activation', tone: 'amber' }],
    [{ effective_status: 'expired' }, { label: 'Subscription expired', tone: 'rose' }],
    [{ effective_status: 'unknown' }, { label: 'Checking subscription…', tone: 'gray' }],
    [{ effective_status: 'none' }, { label: 'No subscription', tone: 'gray' }],
    [{ effective_status: 'unrecognised' }, { label: 'No subscription', tone: 'gray' }],
  ];

  for (const [state, expected] of cases) {
    assert.deepEqual({ ...formatPill(state) }, expected);
  }
});

test('filterRows handles non-arrays, pass-through filters, misses, and absent statuses', () => {
  const { filterRows } = loadService();
  const rows = [
    { id: 1, effective_status: 'active' },
    { id: 2 },
    { id: 3, effective_status: '' },
  ];

  assert.deepEqual(Array.from(filterRows(null, 'active')), []);
  assert.equal(filterRows(rows, 'all'), rows);
  assert.equal(filterRows(rows), rows);
  assert.equal(filterRows(rows, ''), rows);
  assert.deepEqual(Array.from(filterRows(rows, 'grace')), []);
  assert.deepEqual(Array.from(filterRows(rows, 'none'), (row) => row.id), [2, 3]);
});

test('STATUSES is frozen and exact', () => {
  const { STATUSES } = loadService();
  // unknown is intentionally absent even though getEffectiveState can return it;
  // this test records that real asymmetry rather than hiding it.
  assert.deepEqual(Array.from(STATUSES), ['active', 'grace', 'expired', 'pending', 'none']);
  assert.equal(Object.isFrozen(STATUSES), true);
});

test('the effective-state view has no cancelled branch', () => {
  const effectiveStatusCase = VIEW_SQL.match(
    /\bCASE\s+WHEN\b([\s\S]*?)\bEND\s+AS\s+effective_status\b/i,
  );
  assert.ok(effectiveStatusCase, 'effective_status CASE must be present');

  // Consequence: status='cancelled' with a future end_date falls through to
  // current_date <= end_date and reads active, so both implementations grant
  // writes. No supported write path currently sets cancelled; this guard forces
  // any future introduction to update the view in the same change.
  assert.doesNotMatch(effectiveStatusCase[1], /\bWHEN\s+status\s*=\s*'cancelled'/i);
});
