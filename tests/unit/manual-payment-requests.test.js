import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationUrl = process.env.MANUAL_PAYMENT_MIGRATION
  ? new URL(`file:///${process.env.MANUAL_PAYMENT_MIGRATION.replace(/\\/g, '/')}`)
  : new URL(
      '../../supabase/migrations/20260803000000_manual_payment_requests.sql',
      import.meta.url
    );
const rollbackUrl = process.env.MANUAL_PAYMENT_ROLLBACK
  ? new URL(`file:///${process.env.MANUAL_PAYMENT_ROLLBACK.replace(/\\/g, '/')}`)
  : new URL(
      '../../supabase/rollbacks/20260803000000_manual_payment_requests_down.sql',
      import.meta.url
    );

const MIGRATION = readFileSync(migrationUrl, 'utf8');
const ROLLBACK = readFileSync(rollbackUrl, 'utf8');
const FLAT = MIGRATION.replace(/\s+/g, ' ');
const ROLLBACK_FLAT = ROLLBACK.replace(/\s+/g, ' ');

const FUNCTIONS = [
  ['guard_coach_payment_request_update', ''],
  ['request_coach_package_payment', 'text, integer, integer, text'],
  ['mark_coach_payment_sent', 'uuid, text'],
  ['approve_coach_payment', 'uuid, timestamptz, text'],
  ['reject_coach_payment', 'uuid, text'],
];
const RPC_FUNCTIONS = FUNCTIONS.filter(([name]) => name !== 'guard_coach_payment_request_update');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function functionDefinition(name) {
  const match = MIGRATION.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\)\\s*(?:RETURNS|returns)[\\s\\S]*?AS \\$(\\w+)\\$[\\s\\S]*?\\$\\1\\$;`,
      'i'
    )
  );
  assert.ok(match, `missing function definition for ${name}`);
  return match[0].replace(/\s+/g, ' ');
}

test('migration is atomic and enables RLS on both new tables', () => {
  assert.match(MIGRATION, /^BEGIN;$/m);
  assert.match(MIGRATION, /^COMMIT;$/m);
  assert.match(FLAT, /ALTER TABLE public\.payment_settings ENABLE ROW LEVEL SECURITY;/i);
  assert.match(FLAT, /ALTER TABLE public\.coach_payment_requests ENABLE ROW LEVEL SECURITY;/i);
});

test('RPCs are SECURITY DEFINER and every function has a pinned search_path', () => {
  for (const [name] of FUNCTIONS) {
    const definition = functionDefinition(name);
    assert.match(
      definition,
      /SET search_path = public, pg_temp/i,
      `${name} does not pin search_path`
    );
  }
  for (const [name] of RPC_FUNCTIONS) {
    assert.match(functionDefinition(name), /SECURITY DEFINER/i, `${name} is not SECURITY DEFINER`);
  }
});

test('every function ACL excludes public and anon and RPCs grant authenticated only', () => {
  for (const [name, args] of FUNCTIONS) {
    const signature = `${name}\\(${escapeRegex(args).replace(/, /g, ',\\s*')}\\)`;
    assert.match(
      FLAT,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM public, anon;`, 'i'),
      `${name} is not revoked from both public and anon`
    );
    if (name !== 'guard_coach_payment_request_update') {
      assert.match(
        FLAT,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO authenticated;`, 'i'),
        `${name} is not granted only to authenticated`
      );
    }
  }
  assert.doesNotMatch(FLAT, /GRANT\s+EXECUTE[\s\S]*?\bTO\s+anon\b/i);
  assert.doesNotMatch(FLAT, /GRANT\s+EXECUTE[\s\S]*?\bTO\s+service_role\b/i);
});

test('trigger helper is invoker-only and has no direct EXECUTE grant', () => {
  const guard = functionDefinition('guard_coach_payment_request_update');
  assert.match(guard, /SECURITY INVOKER/i);
  assert.doesNotMatch(guard, /SECURITY DEFINER/i);
  assert.doesNotMatch(
    FLAT,
    /GRANT EXECUTE ON FUNCTION public\.guard_coach_payment_request_update\(\)/i
  );
  assert.match(
    FLAT,
    /REVOKE ALL ON FUNCTION public\.guard_coach_payment_request_update\(\) FROM authenticated, service_role;/i
  );
});

test('approval and rejection have internal admin authorization', () => {
  for (const name of ['approve_coach_payment', 'reject_coach_payment']) {
    assert.match(
      functionDefinition(name),
      /IF NOT \(SELECT public\.is_admin\(\)\) THEN/i,
      `${name} lacks its internal admin check`
    );
  }
});

test('manual approval uses request-derived provider idempotency', () => {
  const approval = functionDefinition('approve_coach_payment');
  assert.match(approval, /p_provider\s*=>\s*'manual'/i);
  assert.match(
    approval,
    /v_provider_event_id\s*:=\s*'manual:req:'\s*\|\|\s*p_request_id::text/i
  );
  assert.match(approval, /p_provider_event_id\s*=>\s*v_provider_event_id/i);
  assert.doesNotMatch(approval, /gen_random_uuid\s*\(/i);
});

test('migration never widens the pre-existing apply function ACL', () => {
  assert.doesNotMatch(
    FLAT,
    /GRANT\s+[^;]*ON FUNCTION public\.apply_paid_coach_package_period_system/i
  );
});

test('request RLS has no delete or anon policy', () => {
  assert.doesNotMatch(
    FLAT,
    /CREATE POLICY[^;]*ON public\.coach_payment_requests[^;]*FOR DELETE/i
  );
  assert.doesNotMatch(FLAT, /(?:CREATE|DROP) POLICY[^;]*\banon\b/i);
});

test('coach update is only pending to awaiting_review and protected by a trigger', () => {
  assert.match(
    FLAT,
    /CREATE POLICY "coach_payment_requests_coach_update"[\s\S]*?USING \([\s\S]*?coach_id = \(SELECT auth\.uid\(\)\)[\s\S]*?status = 'pending'[\s\S]*?role = 'coach'[\s\S]*?WITH CHECK \([\s\S]*?coach_id = \(SELECT auth\.uid\(\)\)[\s\S]*?status = 'awaiting_review'[\s\S]*?role = 'coach'/i
  );
  assert.match(FLAT, /BEFORE UPDATE ON public\.coach_payment_requests/i);
  const guard = functionDefinition('guard_coach_payment_request_update');
  for (const column of [
    'package_key',
    'client_limit',
    'months',
    'amount_minor',
    'currency',
    'admin_note',
    'reviewed_by',
    'reviewed_at',
    'payment_event_id',
  ]) {
    assert.match(guard, new RegExp(`NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`, 'i'));
  }
  assert.match(guard, /NEW\.status <> 'awaiting_review'/i);
  assert.match(guard, /RAISE EXCEPTION/i);
});

test('rollback uses full function signatures and stays inside P2C-1', () => {
  for (const [name, args] of FUNCTIONS) {
    const signature = `${name}\\(${escapeRegex(args).replace(/, /g, ',\\s*')}\\)`;
    assert.match(
      ROLLBACK_FLAT,
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${signature};`, 'i'),
      `rollback lacks full signature for ${name}`
    );
  }
  for (const preExisting of [
    'payment_events',
    'apply_paid_coach_package_period_system',
    'coach_subscriptions',
    'notifications',
  ]) {
    assert.doesNotMatch(
      ROLLBACK_FLAT,
      new RegExp(`DROP\\s+(?:TABLE|FUNCTION)[^;]*\\b${preExisting}\\b`, 'i'),
      `rollback must not drop pre-existing ${preExisting}`
    );
  }
});
