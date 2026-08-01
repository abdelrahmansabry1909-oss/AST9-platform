import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function fileUrlFromEnv(name, fallback) {
  return process.env[name]
    ? new URL(`file:///${process.env[name].replace(/\\/g, '/')}`)
    : new URL(fallback, import.meta.url);
}

const MIGRATION = readFileSync(
  fileUrlFromEnv(
    'PACKAGE_PRICES_MIGRATION',
    '../../supabase/migrations/20260804000000_server_side_package_prices.sql'
  ),
  'utf8'
);
const ROLLBACK = readFileSync(
  fileUrlFromEnv(
    'PACKAGE_PRICES_ROLLBACK',
    '../../supabase/rollbacks/20260804000000_server_side_package_prices_down.sql'
  ),
  'utf8'
);
const PRIOR = readFileSync(
  new URL('../../supabase/migrations/20260803000000_manual_payment_requests.sql', import.meta.url),
  'utf8'
);
const FLAT = MIGRATION.replace(/\s+/g, ' ');
const ROLLBACK_FLAT = ROLLBACK.replace(/\s+/g, ' ');

function functionDefinition(sql, name) {
  const match = sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?AS \\$(\\w+)\\$[\\s\\S]*?\\$\\1\\$;`,
      'i'
    )
  );
  assert.ok(match, `missing function definition for ${name}`);
  return match[0].replace(/\s+/g, ' ').trim();
}

function packagePricesTableDefinition() {
  const match = MIGRATION.match(
    /CREATE TABLE IF NOT EXISTS public\.package_prices\s*\(([\s\S]*?)\n\);/i
  );
  assert.ok(match, 'missing package_prices table definition');
  return match[1].replace(/\s+/g, ' ');
}

function seededRows() {
  const seed = MIGRATION.match(
    /INSERT INTO public\.package_prices[\s\S]*?VALUES\s*([\s\S]*?)ON CONFLICT/i
  );
  assert.ok(seed, 'missing package_prices seed');
  const rows = [...seed[1].matchAll(
    /\('([^']+)',\s*(\d+),\s*(\d+),\s*'([^']+)',\s*(\d+|NULL),\s*(\d+|NULL),\s*'([^']+)',\s*(true|false)\)/gi
  )].map((match) => ({
    packageKey: match[1],
    months: Number(match[2]),
    listAmount: Number(match[3]),
    listCurrency: match[4],
    listWasAmount: match[5].toUpperCase() === 'NULL' ? null : Number(match[5]),
    chargeAmount: match[6].toUpperCase() === 'NULL' ? null : Number(match[6]),
    chargeCurrency: match[7],
    active: match[8].toLowerCase() === 'true',
  }));
  assert.equal(rows.length, 8, 'seed must contain exactly eight parseable rows');
  return rows;
}

test('migration drops the unsafe four-argument overload before creating the replacement', () => {
  const drop = /DROP FUNCTION IF EXISTS public\.request_coach_package_payment\(text,\s*integer,\s*integer,\s*text\);/i;
  assert.match(
    MIGRATION,
    drop,
    'overload trap: the caller-supplied-amount four-argument function was not dropped'
  );
  assert.ok(
    MIGRATION.search(drop) < MIGRATION.search(/CREATE OR REPLACE FUNCTION public\.request_coach_package_payment\s*\(\s*p_package_key text,\s*p_months integer\s*\)/i),
    'overload trap: the old function must be dropped before the two-argument function is created'
  );
});

test('new request RPC is SECURITY DEFINER with a pinned search_path', () => {
  const definition = functionDefinition(MIGRATION, 'request_coach_package_payment');
  assert.match(definition, /SECURITY DEFINER/i);
  assert.match(definition, /SET search_path = public, pg_temp/i);
});

test('new request RPC is executable only by authenticated', () => {
  assert.match(
    FLAT,
    /REVOKE ALL ON FUNCTION public\.request_coach_package_payment\(text, integer\) FROM public, anon;/i
  );
  assert.match(
    FLAT,
    /GRANT EXECUTE ON FUNCTION public\.request_coach_package_payment\(text, integer\) TO authenticated;/i
  );
  const grants = [...FLAT.matchAll(
    /GRANT EXECUTE ON FUNCTION public\.request_coach_package_payment\(text, integer\) TO ([^;]+);/gi
  )].map((match) => match[1].trim().toLowerCase());
  assert.deepEqual(grants, ['authenticated']);
});

test('request RPC resolves an active server charge and returns charge plus list values', () => {
  const definition = functionDefinition(MIGRATION, 'request_coach_package_payment');
  assert.match(
    definition,
    /FROM public\.package_prices WHERE package_key = p_package_key AND months = p_months AND active = true AND charge_amount_minor IS NOT NULL/i
  );
  assert.match(definition, /IF NOT FOUND THEN RAISE EXCEPTION 'package price is unavailable or inactive'/i);
  assert.match(
    definition,
    /v_price\.charge_amount_minor, v_price\.charge_currency\) RETURNING id INTO v_request_id/i
  );
  for (const field of ['amount_minor', 'currency', 'list_amount_minor', 'list_currency']) {
    assert.match(definition, new RegExp(`'${field}'\\s*,`, 'i'), `response omits ${field}`);
  }
});

test('all eight authoritative USD catalog rows are seeded exactly', () => {
  const expected = [
    ['starter', 1, 500, 1000],
    ['starter', 12, 5000, 10000],
    ['growth', 1, 1000, 2000],
    ['growth', 12, 10000, 20000],
    ['pro', 1, 2000, 3500],
    ['pro', 12, 20000, 35000],
    ['scale', 1, 3500, 4500],
    ['scale', 12, 35000, 45000],
  ];
  assert.deepEqual(
    seededRows().map((row) => [row.packageKey, row.months, row.listAmount, row.listWasAmount]),
    expected
  );
  for (const row of seededRows()) {
    assert.equal(row.listCurrency, 'USD');
    assert.equal(row.chargeCurrency, 'EGP');
  }
});

test('all seeded EGP charges are NULL and all seeded rows are inactive', () => {
  for (const row of seededRows()) {
    assert.equal(row.chargeAmount, null, `${row.packageKey}/${row.months} invents an EGP charge`);
    assert.equal(row.active, false, `${row.packageKey}/${row.months} ships active`);
  }
});

test('schema admits only the four self-service keys and 1 or 12 months', () => {
  const table = packagePricesTableDefinition();
  const packageCheck = table.match(/CHECK\s*\(package_key IN\s*\(([^)]+)\)\)/i);
  assert.ok(packageCheck, 'missing package_key CHECK');
  assert.deepEqual(
    [...packageCheck[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['starter', 'growth', 'pro', 'scale']
  );
  assert.doesNotMatch(packageCheck[1], /\b(?:free|custom)\b/i);

  const monthsCheck = table.match(/CHECK\s*\(months IN\s*\(([^)]+)\)\)/i);
  assert.ok(monthsCheck, 'missing months CHECK');
  assert.deepEqual(
    monthsCheck[1].split(',').map((value) => Number(value.trim())),
    [1, 12]
  );
});

test('active rows must have a non-NULL EGP charge', () => {
  assert.match(
    packagePricesTableDefinition(),
    /CHECK\s*\(\s*NOT active OR charge_amount_minor IS NOT NULL\s*\)/i
  );
});

test('package_prices RLS exposes reads but restricts every write to admin', () => {
  assert.match(FLAT, /ALTER TABLE public\.package_prices ENABLE ROW LEVEL SECURITY;/i);
  assert.match(FLAT, /REVOKE ALL ON TABLE public\.package_prices FROM anon;/i);
  assert.doesNotMatch(
    FLAT,
    /CREATE POLICY[^;]*ON public\.package_prices[^;]*\bTO\s+anon\b/i
  );
  const allPolicies = [...FLAT.matchAll(
    /CREATE POLICY[^;]*ON public\.package_prices[^;]*;/gi
  )];
  assert.equal(allPolicies.length, 4, 'package_prices must have exactly four policies');
  for (const policy of allPolicies) {
    assert.match(policy[0], /\bTO authenticated\b/i, 'policy could apply to anon or PUBLIC');
  }
  assert.match(
    FLAT,
    /CREATE POLICY "package_prices_authenticated_select" ON public\.package_prices FOR SELECT TO authenticated USING \(true\);/i
  );
  assert.doesNotMatch(
    FLAT,
    /CREATE POLICY[^;]*ON public\.package_prices[^;]*FOR ALL\b/i,
    'an ALL policy could introduce a non-admin write path'
  );
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const policies = [...FLAT.matchAll(
      new RegExp(`CREATE POLICY [^;]+ ON public\\.package_prices FOR ${operation}\\b([^;]+);`, 'gi')
    )];
    assert.equal(policies.length, 1, `expected exactly one ${operation} policy`);
    assert.match(policies[0][1], /\bTO authenticated\b/i, `${operation} policy targets another role`);
    assert.match(
      policies[0][1],
      /\(SELECT public\.is_admin\(\)\)/i,
      `${operation} policy is not admin-only`
    );
  }
});

test('rollback restores the prior four-argument RPC verbatim and its ACL', () => {
  assert.equal(
    functionDefinition(ROLLBACK, 'request_coach_package_payment'),
    functionDefinition(PRIOR, 'request_coach_package_payment')
  );
  assert.match(
    ROLLBACK_FLAT,
    /REVOKE ALL ON FUNCTION public\.request_coach_package_payment\(text, integer, integer, text\) FROM public, anon;/i
  );
  assert.match(
    ROLLBACK_FLAT,
    /GRANT EXECUTE ON FUNCTION public\.request_coach_package_payment\(text, integer, integer, text\) TO authenticated;/i
  );
});

test('rollback drops only objects introduced by this migration', () => {
  assert.match(
    ROLLBACK_FLAT,
    /DROP FUNCTION IF EXISTS public\.request_coach_package_payment\(text, integer\);/i
  );
  assert.match(ROLLBACK_FLAT, /DROP TABLE IF EXISTS public\.package_prices;/i);
  for (const preExisting of [
    'payment_settings',
    'coach_payment_requests',
    'payment_events',
    'apply_paid_coach_package_period_system',
    'coach_subscriptions',
    'notifications',
    'profiles',
  ]) {
    assert.doesNotMatch(
      ROLLBACK_FLAT,
      new RegExp(`DROP\\s+(?:TABLE|FUNCTION|TRIGGER|POLICY)[^;]*\\b${preExisting}\\b`, 'i'),
      `rollback must not drop pre-existing ${preExisting}`
    );
  }
});
