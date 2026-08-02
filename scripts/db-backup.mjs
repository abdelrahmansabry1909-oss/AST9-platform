#!/usr/bin/env node
/**
 * Local off-platform backup of the AST9 production database.
 *
 * The Supabase organisation is on the Free plan: no automated backups and no
 * PITR (docs/DISASTER_RECOVERY.md). Whatever this script produces is the only
 * recovery point that will exist, so every failure mode is made loud — a run
 * that cannot produce a verified artifact deletes its own partial output and
 * exits non-zero rather than leaving something that looks like a backup.
 *
 * The script never handles a database password. `supabase db dump --linked`
 * mints its own short-lived login role from the CLI's stored token, so no
 * credential is passed on the command line, read from the environment, or
 * written to any file produced here.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_ENTRY = resolve(REPO_ROOT, 'node_modules/supabase/dist/supabase.js');
const LINK_STATE = resolve(REPO_ROOT, 'supabase/.temp/project-ref');
const CLI_PACKAGE = resolve(REPO_ROOT, 'node_modules/supabase/package.json');

export const DEST_KEY = 'AST9_BACKUP_DEST';
export const KEEP_KEY = 'AST9_BACKUP_KEEP';
export const DEFAULT_KEEP = 14;
export const BACKUP_PREFIX = 'ast9-backup-';
export const RUN_PREFIX = '.incomplete-';
export const STATUS_FILE = 'backup-status.json';
export const MANIFEST_FILE = 'manifest.json';

/**
 * Restore order matters: roles must exist before the schema that grants to them,
 * and the schema before the data. The markers are the integrity check — an
 * artifact that parses as SQL but lacks them is a silent partial backup, which
 * is the failure this script exists to prevent. `auth.users` is listed because
 * losing it while keeping `public.profiles` produces orphaned rows and a
 * database nobody can sign in to.
 */
export const DUMP_ARTIFACTS = Object.freeze([
  Object.freeze({ file: 'roles.sql', flags: Object.freeze(['--role-only']), markers: Object.freeze([]) }),
  Object.freeze({ file: 'schema.sql', flags: Object.freeze([]), markers: Object.freeze(['"public"."profiles"']) }),
  Object.freeze({
    file: 'data.sql',
    flags: Object.freeze(['--data-only', '--use-copy']),
    markers: Object.freeze(['"auth"."users"', '"public"."profiles"']),
  }),
]);

/** Stated in every manifest so a future operator cannot assume a full recovery. */
export const NOT_INCLUDED = Object.freeze([
  'Supabase Vault secret values — the vault schema is excluded from the data dump.',
  'Storage API objects — the database holds only their metadata.',
  'Edge Function source deployment state and runtime secrets.',
  'Auth signing keys and project API keys.',
  'The supabase_migrations history table, and auth.schema_migrations.',
]);

function requiredValue(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

/**
 * The CLI prints a minted login role as `export PGPASSWORD="..."` shell lines,
 * not as a URI, so both shapes are redacted before any child output is logged.
 */
export function sanitizeOutput(text) {
  return String(text ?? '')
    .replace(/^(\s*export\s+PG(?:PASSWORD|USER|HOST|DATABASE)=).*$/gim, '$1"***"')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+@/gi, '$1***@');
}

export function parseBackupArgs(argv) {
  const args = { check: false, dest: '', keep: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      args.check = true;
    } else if (argument === '--dest') {
      args.dest = requiredValue(argv[index + 1], '--dest');
      index += 1;
    } else if (argument === '--keep') {
      args.keep = requiredValue(argv[index + 1], '--keep');
      index += 1;
    } else {
      throw new Error(`Unknown backup argument: ${argument}`);
    }
  }
  return args;
}

export function parseKeepCount(value, fallback = DEFAULT_KEEP) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${KEEP_KEY} must be a whole number of retained backups (1 or more).`);
  }
  return parsed;
}

export function findGitAncestor(startDir, exists = existsSync) {
  let current = resolve(startDir);
  for (;;) {
    if (exists(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * This repository is public and GitHub Actions artifacts on a public repository
 * are downloadable by anyone, so a dump that lands inside any working tree is
 * one `git add` away from publishing every client health record.
 */
export function assertDestinationSafe(destination, repoRoot = REPO_ROOT, exists = existsSync) {
  const normalized = requiredValue(destination, DEST_KEY);
  if (!isAbsolute(normalized)) {
    throw new Error(`${DEST_KEY} must be an absolute path.`);
  }
  const target = resolve(normalized);
  const fromRepo = relative(resolve(repoRoot), target);
  if (fromRepo === '' || (!fromRepo.startsWith('..') && !isAbsolute(fromRepo))) {
    throw new Error(`${DEST_KEY} must not be inside the repository — this repository is public.`);
  }
  const gitAncestor = findGitAncestor(target, exists);
  if (gitAncestor) {
    throw new Error(
      `${DEST_KEY} is inside a git working tree (${gitAncestor}); dumps must never be committable.`
    );
  }
  return target;
}

export function resolveBackupConfig(args, env = process.env, repoRoot = REPO_ROOT, exists = existsSync) {
  return Object.freeze({
    destination: assertDestinationSafe(args.dest || env[DEST_KEY], repoRoot, exists),
    keep: parseKeepCount(args.keep || env[KEEP_KEY]),
  });
}

/** Sorts lexicographically, which for this stamp format is chronological. */
export function formatBackupStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function selectPrunableBackups(names, keep) {
  const completed = names.filter((name) => name.startsWith(BACKUP_PREFIX)).sort();
  return completed.slice(0, Math.max(0, completed.length - keep));
}

export function selectAbandonedRuns(names, currentRunName) {
  return names.filter((name) => name.startsWith(RUN_PREFIX) && name !== currentRunName);
}

export function verifyDumpArtifact(spec, contents) {
  if (!contents.length) {
    throw new Error(`${spec.file} is empty — the dump produced no usable artifact.`);
  }
  const missing = spec.markers.filter((marker) => !contents.includes(marker));
  if (missing.length) {
    throw new Error(`${spec.file} is missing required content: ${missing.join(', ')}.`);
  }
  return contents.length;
}

export function buildDumpArgs(spec, outputPath) {
  return ['db', 'dump', '--linked', ...spec.flags, '--file', outputPath];
}

export function buildManifest(details) {
  return {
    tool: 'scripts/db-backup.mjs',
    stamp: details.stamp,
    startedUtc: details.startedUtc,
    finishedUtc: details.finishedUtc,
    cliVersion: details.cliVersion,
    repoCommit: details.repoCommit,
    files: details.files,
    restoreOrder: DUMP_ARTIFACTS.map((spec) => spec.file),
    notIncluded: NOT_INCLUDED,
  };
}

export function nextStatus(previous, outcome) {
  const priorFailures = Number(previous?.consecutiveFailures) || 0;
  return {
    lastAttemptUtc: outcome.attemptUtc,
    lastSuccessUtc: outcome.ok ? outcome.attemptUtc : (previous?.lastSuccessUtc ?? null),
    lastSuccessDir: outcome.ok ? outcome.dir : (previous?.lastSuccessDir ?? null),
    consecutiveFailures: outcome.ok ? 0 : priorFailures + 1,
    lastError: outcome.ok ? null : outcome.message,
  };
}

function readCliVersion() {
  return JSON.parse(readFileSync(CLI_PACKAGE, 'utf8')).version;
}

function readRepoCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertToolchainReady() {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error('Supabase CLI is not installed — run "npm ci" in the repository first.');
  }
  if (!existsSync(LINK_STATE)) {
    throw new Error('No linked Supabase project — run "npx supabase link" in the repository first.');
  }
  const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (docker.error || docker.status !== 0) {
    throw new Error(
      'Docker is not running. "supabase db dump" executes pg_dump inside a container, '
        + 'so Docker Desktop must be started before this backup can run.'
    );
  }
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Supabase CLI could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `"supabase ${args.slice(0, 2).join(' ')}" failed:\n`
        + sanitizeOutput(`${result.stdout ?? ''}${result.stderr ?? ''}`)
    );
  }
}

function dumpArtifact(spec, runDir) {
  const outputPath = join(runDir, spec.file);
  runCli(buildDumpArgs(spec, outputPath));
  const contents = readFileSync(outputPath);
  verifyDumpArtifact(spec, contents);
  return {
    name: spec.file,
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

function pruneDestination(config, currentRunName) {
  const names = readdirSync(config.destination, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const removable = [
    ...selectAbandonedRuns(names, currentRunName),
    ...selectPrunableBackups(names, config.keep),
  ];
  for (const name of removable) {
    rmSync(join(config.destination, name), { recursive: true, force: true });
  }
  return removable;
}

function recordStatus(destination, outcome) {
  const statusPath = join(destination, STATUS_FILE);
  const previous = existsSync(statusPath)
    ? JSON.parse(readFileSync(statusPath, 'utf8'))
    : null;
  writeFileSync(statusPath, `${JSON.stringify(nextStatus(previous, outcome), null, 2)}\n`);
}

function executeBackup(config) {
  const startedAt = new Date();
  const stamp = formatBackupStamp(startedAt);
  const runName = `${RUN_PREFIX}${stamp}`;
  const runDir = join(config.destination, runName);
  const finalDir = join(config.destination, `${BACKUP_PREFIX}${stamp}`);

  mkdirSync(runDir, { recursive: true });
  try {
    const files = DUMP_ARTIFACTS.map((spec) => dumpArtifact(spec, runDir));
    const manifest = buildManifest({
      stamp,
      startedUtc: startedAt.toISOString(),
      finishedUtc: new Date().toISOString(),
      cliVersion: readCliVersion(),
      repoCommit: readRepoCommit(),
      files,
    });
    writeFileSync(join(runDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(runDir, finalDir);
  } catch (error) {
    rmSync(runDir, { recursive: true, force: true });
    recordStatus(config.destination, {
      ok: false,
      attemptUtc: startedAt.toISOString(),
      message: sanitizeOutput(error.message),
    });
    throw error;
  }

  const pruned = pruneDestination(config, runName);
  recordStatus(config.destination, {
    ok: true,
    attemptUtc: startedAt.toISOString(),
    dir: finalDir,
  });
  return { finalDir, pruned };
}

function printCheckReport(config) {
  console.log('AST9 database backup pre-flight passed.');
  console.log(`  destination     : ${config.destination}`);
  console.log(`  retained copies : ${config.keep}`);
  console.log(`  artifacts       : ${DUMP_ARTIFACTS.map((spec) => spec.file).join(', ')}`);
  console.log('');
  console.log('No credential is read or written by this script; the CLI uses the linked project.');
  console.log('Nothing has been dumped. Re-run without --check to take a backup.');
}

function run(argv) {
  const args = parseBackupArgs(argv);
  const config = resolveBackupConfig(args);
  assertToolchainReady();
  if (args.check) {
    printCheckReport(config);
    return;
  }
  mkdirSync(config.destination, { recursive: true });
  const { finalDir, pruned } = executeBackup(config);
  console.log(`Backup verified and written to ${finalDir}`);
  if (pruned.length) console.log(`Pruned ${pruned.length} older director${pruned.length === 1 ? 'y' : 'ies'}.`);
  console.log('An export nobody has restored is not a backup — see docs/DATABASE_BACKUP.md.');
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(`Database backup failed: ${sanitizeOutput(error.message)}`);
    process.exitCode = 1;
  }
}
