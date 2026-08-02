import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BACKUP_PREFIX,
  DEFAULT_KEEP,
  DEST_KEY,
  DUMP_ARTIFACTS,
  RUN_PREFIX,
  assertDestinationSafe,
  buildDumpArgs,
  findGitAncestor,
  formatBackupStamp,
  nextStatus,
  parseBackupArgs,
  parseKeepCount,
  sanitizeOutput,
  selectAbandonedRuns,
  selectPrunableBackups,
  verifyDumpArtifact,
} from '../../scripts/db-backup.mjs';

const fakeRepoRoot = resolve('/fake/ast9-repo');
const outsideDestination = resolve('/fake/ast9-backups');
const noGitAnywhere = () => false;

test('backup arguments parse into check, destination, and retention', () => {
  assert.deepEqual(parseBackupArgs([]), { check: false, dest: '', keep: '' });
  assert.deepEqual(parseBackupArgs(['--check', '--dest', outsideDestination, '--keep', '7']), {
    check: true,
    dest: outsideDestination,
    keep: '7',
  });
  assert.throws(() => parseBackupArgs(['--wipe']), /Unknown backup argument/);
  assert.throws(() => parseBackupArgs(['--dest']), /--dest is required/);
});

test('retention count defaults and rejects values that would discard every copy', () => {
  assert.equal(parseKeepCount(''), DEFAULT_KEEP);
  assert.equal(parseKeepCount(undefined), DEFAULT_KEEP);
  assert.equal(parseKeepCount('7'), 7);
  assert.throws(() => parseKeepCount('0'), /1 or more/);
  assert.throws(() => parseKeepCount('-3'), /1 or more/);
  assert.throws(() => parseKeepCount('2.5'), /1 or more/);
  assert.throws(() => parseKeepCount('all'), /1 or more/);
});

test('destination is refused anywhere a dump could become committable', () => {
  assert.throws(() => assertDestinationSafe('', fakeRepoRoot, noGitAnywhere), new RegExp(DEST_KEY));
  assert.throws(
    () => assertDestinationSafe('relative/backups', fakeRepoRoot, noGitAnywhere),
    /absolute path/
  );
  assert.throws(
    () => assertDestinationSafe(join(fakeRepoRoot, 'backups'), fakeRepoRoot, noGitAnywhere),
    /inside the repository/
  );
  assert.throws(
    () => assertDestinationSafe(fakeRepoRoot, fakeRepoRoot, noGitAnywhere),
    /inside the repository/
  );
  const gitAtParent = (path) => path === join(resolve('/fake'), '.git');
  assert.throws(
    () => assertDestinationSafe(outsideDestination, fakeRepoRoot, gitAtParent),
    /inside a git working tree/
  );
});

test('destination outside every working tree is accepted and normalised', () => {
  const redundant = join(outsideDestination, 'nested', '..');
  assert.equal(assertDestinationSafe(redundant, fakeRepoRoot, noGitAnywhere), outsideDestination);
  assert.equal(
    assertDestinationSafe(`  ${outsideDestination}  `, fakeRepoRoot, noGitAnywhere),
    outsideDestination
  );
});

test('git ancestor search walks up and terminates at the filesystem root', () => {
  const gitAtFake = (path) => path === join(resolve('/fake'), '.git');
  assert.equal(findGitAncestor(outsideDestination, gitAtFake), resolve('/fake'));
  assert.equal(findGitAncestor(outsideDestination, noGitAnywhere), null);
});

test('sanitiser redacts the shell-export credential shape the CLI actually printed', () => {
  const observed = [
    'export PGHOST="aws-0-example-region.pooler.example.invalid"',
    'export PGUSER="cli_login_postgres.exampleprojectref"',
    'export PGPASSWORD="ExampleSecretValue123"',
    'export PGDATABASE="postgres"',
  ].join('\n');
  const cleaned = sanitizeOutput(observed);
  assert.doesNotMatch(cleaned, /ExampleSecretValue123/);
  assert.doesNotMatch(cleaned, /cli_login_postgres/);
  assert.doesNotMatch(cleaned, /pooler\.example\.invalid/);
  assert.match(cleaned, /export PGPASSWORD="\*\*\*"/);
});

test('sanitiser also redacts credentials embedded in a connection URI', () => {
  const cleaned = sanitizeOutput('failed: postgresql://postgres:ExampleSecret@db.example.supabase.co:5432/postgres');
  assert.doesNotMatch(cleaned, /ExampleSecret/);
  assert.match(cleaned, /postgresql:\/\/\*\*\*@/);
});

test('backup stamps are filesystem safe and sort chronologically', () => {
  const earlier = formatBackupStamp(new Date('2026-08-02T03:15:00.000Z'));
  const later = formatBackupStamp(new Date('2026-08-02T04:15:00.000Z'));
  assert.equal(earlier, '20260802T031500Z');
  assert.ok(earlier < later);
  assert.doesNotMatch(earlier, /[:\\/]/);
});

test('pruning keeps the newest copies and ignores incomplete runs', () => {
  const names = [
    `${BACKUP_PREFIX}20260801T030000Z`,
    `${BACKUP_PREFIX}20260803T030000Z`,
    `${BACKUP_PREFIX}20260802T030000Z`,
    `${RUN_PREFIX}20260804T030000Z`,
    'backup-status.json',
  ];
  assert.deepEqual(selectPrunableBackups(names, 2), [`${BACKUP_PREFIX}20260801T030000Z`]);
  assert.deepEqual(selectPrunableBackups(names, 3), []);
  assert.deepEqual(selectPrunableBackups(names, 10), []);
});

test('abandoned runs are cleared except the run currently writing', () => {
  const current = `${RUN_PREFIX}20260804T030000Z`;
  const names = [current, `${RUN_PREFIX}20260803T030000Z`, `${BACKUP_PREFIX}20260802T030000Z`];
  assert.deepEqual(selectAbandonedRuns(names, current), [`${RUN_PREFIX}20260803T030000Z`]);
});

test('artifact verification fails an empty dump and a dump missing auth data', () => {
  const dataSpec = DUMP_ARTIFACTS.find((spec) => spec.file === 'data.sql');
  assert.throws(() => verifyDumpArtifact(dataSpec, Buffer.from('')), /is empty/);
  assert.throws(
    () => verifyDumpArtifact(dataSpec, Buffer.from('COPY "public"."profiles" FROM stdin;')),
    /"auth"\."users"/
  );
  const complete = Buffer.from('COPY "auth"."users" FROM stdin;\nCOPY "public"."profiles" FROM stdin;');
  assert.equal(verifyDumpArtifact(dataSpec, complete), complete.length);
});

test('schema artifact must contain the core application table', () => {
  const schemaSpec = DUMP_ARTIFACTS.find((spec) => spec.file === 'schema.sql');
  assert.throws(
    () => verifyDumpArtifact(schemaSpec, Buffer.from('CREATE TABLE IF NOT EXISTS "public"."other" ();')),
    /"public"\."profiles"/
  );
});

test('dump invocation uses the linked project and never a connection string', () => {
  for (const spec of DUMP_ARTIFACTS) {
    const args = buildDumpArgs(spec, join(outsideDestination, spec.file));
    assert.deepEqual(args.slice(0, 3), ['db', 'dump', '--linked']);
    assert.ok(!args.includes('--db-url'), `${spec.file} must not pass --db-url`);
    assert.ok(!args.includes('--password'), `${spec.file} must not pass --password`);
    assert.ok(!args.includes('--dry-run'), `${spec.file} must not pass --dry-run`);
    assert.equal(args.at(-2), '--file');
  }
});

test('status tracking distinguishes a stale success from a repeated failure', () => {
  const firstFailure = nextStatus(null, {
    ok: false,
    attemptUtc: '2026-08-02T03:00:00.000Z',
    message: 'Docker is not running.',
  });
  assert.equal(firstFailure.lastSuccessUtc, null);
  assert.equal(firstFailure.consecutiveFailures, 1);

  const secondFailure = nextStatus(firstFailure, {
    ok: false,
    attemptUtc: '2026-08-03T03:00:00.000Z',
    message: 'Docker is not running.',
  });
  assert.equal(secondFailure.consecutiveFailures, 2);

  const success = nextStatus(secondFailure, {
    ok: true,
    attemptUtc: '2026-08-04T03:00:00.000Z',
    dir: join(outsideDestination, `${BACKUP_PREFIX}20260804T030000Z`),
  });
  assert.equal(success.consecutiveFailures, 0);
  assert.equal(success.lastError, null);
  assert.equal(success.lastSuccessUtc, '2026-08-04T03:00:00.000Z');
});

test('the backup script never invokes the dry-run mode that prints a live credential', () => {
  const source = readFileSync(new URL('../../scripts/db-backup.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'--dry-run'|"--dry-run"/);
  assert.doesNotMatch(source, /'--db-url'|"--db-url"/);
  assert.doesNotMatch(source, /'--password'|"--password"/);
});
