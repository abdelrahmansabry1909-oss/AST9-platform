// tests/unit/upper-body-rom-columns.test.js
//
// Guards the persistence gap recorded as KNOWN_LIMITATIONS L21 and, more
// importantly, the way fixing it can go wrong.
//
// THE HAZARD. The objective assessment is written by a single INSERT in
// js/dashboard.js. PostgREST rejects the whole insert if any one column is
// unknown, and that insert sits inside a catch that only console.warns
// ("Supabase save (non-fatal)"). So a frontend that writes a column the
// database does not have yet does not fail loudly — it silently discards the
// ENTIRE objective assessment, lower body included, on every save.
//
// The test that matters here is therefore not "does the migration look right"
// but "does every column the frontend writes actually exist somewhere". That
// one fails on the dangerous ordering no matter which side introduces it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const MIGRATION = '20260809000000_upper_body_rom_columns.sql';
const forward = read(`supabase/migrations/${MIGRATION}`);
const rollback = read(`supabase/migrations/rollbacks/${MIGRATION.replace(/\.sql$/, '_down.sql')}`);
const baseline = read('supabase/baseline/production_public_schema.sql');
const dashboard = read('js/dashboard.js');
const appHtml = read('app.html');

const TABLE = 'rehab_objective_assessments';

const added = [...forward.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_]+)\s/g)].map((m) => m[1]);
const dropped = [...rollback.matchAll(/DROP COLUMN IF EXISTS\s+([a-z_]+)/g)].map((m) => m[1]);

// Columns the table already had, straight from the production baseline.
function baselineColumns() {
  const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${TABLE}"`);
  assert.ok(start > -1, `${TABLE} not found in the production baseline`);
  const end = baseline.indexOf(');', start);
  return [...baseline.slice(start, end).matchAll(/^\s*"([a-z_]+)"\s+/gm)].map((m) => m[1]);
}

// The keys of the single INSERT payload. NB: the payload pairs left/right on
// one line, so an anchored per-line match finds only half of them.
function insertedColumns() {
  const start = dashboard.indexOf(`from('${TABLE}').insert({`);
  assert.ok(start > -1, `could not find the ${TABLE} insert in js/dashboard.js`);
  const end = dashboard.indexOf('});', start);
  return [...dashboard.slice(start, end).matchAll(/(?:^|[\s,{])([a-z_]+):/gm)].map((m) => m[1]);
}

test('the rollback drops exactly what the migration adds', () => {
  assert.ok(added.length > 0, 'the migration adds no columns');
  assert.deepEqual(
    [...dropped].sort(),
    [...added].sort(),
    'the rollback and the migration disagree — either a column survives the rollback '
    + 'or the rollback drops something this migration did not create',
  );
});

test('every added column is genuinely new', () => {
  const existing = new Set(baselineColumns());
  const collisions = added.filter((c) => existing.has(c));
  assert.deepEqual(collisions, [], `these columns already exist on ${TABLE}: ${collisions.join(', ')}`);
});

test('every added column has a live form input behind it', () => {
  // A column with nothing feeding it is speculative storage. Each added column
  // maps to an input a coach can actually fill.
  const inputFor = {
    shoulder_abduction_left: 'ns-sh-abd-l',   shoulder_abduction_right: 'ns-sh-abd-r',
    thoracic_rotation_left:  'ns-thor-rot-l', thoracic_rotation_right:  'ns-thor-rot-r',
    thoracic_extension:      'ns-thor-ext',   thoracic_flexion:         'ns-thor-flex',
    cervical_rotation_left:  'ns-cerv-rot-l', cervical_rotation_right:  'ns-cerv-rot-r',
    cervical_flexion_note:   'ns-cerv-flex',  cervical_extension_note:  'ns-cerv-ext',
    elbow_flexion_left:      'ns-elbow-flex-l', elbow_flexion_right:    'ns-elbow-flex-r',
    elbow_extension_left:    'ns-elbow-ext-l',  elbow_extension_right:  'ns-elbow-ext-r',
    wrist_flexion_left:      'ns-wrist-flex-l', wrist_flexion_right:    'ns-wrist-flex-r',
    wrist_extension_left:    'ns-wrist-ext-l',  wrist_extension_right:  'ns-wrist-ext-r',
    lumbar_flexion_range:    'ns-lumb-flex',  lumbar_extension_range:   'ns-lumb-ext',
    si_joint_pain:           'ns-si-pain',
  };
  const unmapped = added.filter((c) => !inputFor[c]);
  assert.deepEqual(unmapped, [], `added with no form input mapped: ${unmapped.join(', ')}`);

  const missingInputs = added.filter((c) => !appHtml.includes(`id="${inputFor[c]}"`));
  assert.deepEqual(missingInputs, [], `form input missing for: ${missingInputs.join(', ')}`);
});

test('the migration is additive only', () => {
  // Anything that rewrites an existing column, policy or function belongs in
  // its own migration with its own review.
  assert.ok(!/DROP\s+COLUMN/i.test(forward), 'the forward migration drops a column');
  assert.ok(!/ALTER\s+COLUMN/i.test(forward), 'the forward migration alters an existing column');
  assert.ok(!/DROP\s+(POLICY|FUNCTION|TABLE|CONSTRAINT)/i.test(forward), 'the forward migration drops an object');
  assert.ok(!/CREATE\s+POLICY/i.test(forward), 'policy changes belong in their own migration');
  assert.match(forward, /BEGIN;/, 'the migration is not wrapped in a transaction');
  assert.match(forward, /COMMIT;/, 'the migration is not wrapped in a transaction');
});

test('the vestigial spine_* columns are left alone', () => {
  // They are text buckets from an earlier design with no form input. The new
  // thoracic and lumbar data is numeric degrees; overloading them would bury
  // two meanings in one column.
  assert.ok(!/spine_/.test(forward.replace(/--[^\n]*/g, '')),
    'the migration touches a spine_* column outside of commentary');
});

test('THE HAZARD: every column the frontend writes exists somewhere', () => {
  // This is the one that catches the dangerous deployment order. If the write
  // path ever names a column that neither the baseline nor a migration
  // provides, every objective assessment save fails silently.
  const known = new Set(baselineColumns());
  for (const file of readdirSync(new URL('supabase/migrations/', root))) {
    if (!file.endsWith('.sql')) continue;
    const sql = read(`supabase/migrations/${file}`);
    for (const m of sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_]+)\s/g)) known.add(m[1]);
  }
  const orphans = insertedColumns().filter((c) => !known.has(c));
  assert.deepEqual(
    orphans,
    [],
    `js/dashboard.js writes column(s) that exist in no migration or baseline: ${orphans.join(', ')}. `
    + 'PostgREST rejects the whole insert, and the catch swallows it, so EVERY objective '
    + 'assessment would be silently discarded — not just these fields.',
  );
});

test('THE INVERSE: every column this migration adds is actually written', () => {
  // shoulder_extension_left/right sat unwritten for months while their columns
  // existed, so the values a coach typed were silently discarded on save. A
  // column nothing writes is dead storage and looks identical to a working one
  // from the schema alone.
  const written = new Set(insertedColumns());
  const unwritten = added.filter((c) => !written.has(c));
  assert.deepEqual(
    unwritten,
    [],
    `column(s) added by the migration but never written by js/dashboard.js: ${unwritten.join(', ')}. `
    + 'A coach can type these and they will be discarded on save.',
  );
});

test('the four long-unwritten legacy columns are now written too', () => {
  // These predate the upper-body work: the columns existed, the form collected
  // them, js/scoring.js read them, and the insert simply omitted them.
  const written = new Set(insertedColumns());
  for (const col of ['shoulder_extension_left', 'shoulder_extension_right',
                     'ankle_supination_left', 'ankle_supination_right']) {
    assert.ok(written.has(col), `${col} has a column and a form input but is still not written`);
  }
});

test('changing js/dashboard.js moved its cache-bust token', () => {
  // js/*.js is served static and unhashed, so without a bump the browser keeps
  // the old copy and the new columns are never written by the deployed app.
  const token = appHtml.match(/js\/dashboard\.js\?v=([\w-]+)/)?.[1];
  assert.ok(token, 'js/dashboard.js has no ?v= token in app.html');
  assert.notEqual(token, '20260704b',
    'js/dashboard.js changed but its ?v= token is still the pre-write-path value');
});

test('the deployment-order hazard is documented in the migration', () => {
  // The next person to touch this needs to know before they ship the frontend.
  assert.match(forward, /DEPLOYMENT ORDER MATTERS/,
    'the migration must state that it has to be applied before the frontend write path');
});
