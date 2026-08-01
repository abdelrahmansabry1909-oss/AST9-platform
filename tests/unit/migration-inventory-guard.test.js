import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const repositoryRoot = new URL('../../', import.meta.url);
const inventory = readFileSync(
  new URL('docs/MIGRATION_ROLLBACK_INVENTORY.md', repositoryRoot),
  'utf8'
);
const migrationDirectory = new URL('supabase/migrations/', repositoryRoot);
const rollbackDirectories = [
  {
    location: 'supabase/rollbacks/',
    url: new URL('supabase/rollbacks/', repositoryRoot),
  },
  {
    location: 'supabase/migrations/rollbacks/',
    url: new URL('supabase/migrations/rollbacks/', repositoryRoot),
  },
];
const migrationFiles = readdirSync(migrationDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort();
const rollbackFilesByDirectory = rollbackDirectories.map(({ location, url }) => ({
  location,
  files: readdirSync(url, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort(),
}));
const inventoryRows = [
  ...inventory.matchAll(
    /^\| `([^`]+\.sql)` \| ([^|]+) \| ([^|]+) \| [^|]*\|\r?$/gm
  ),
].map(([, migration, status, location]) => ({
  migration,
  status: status.trim(),
  location: location.trim().replace(/^`|`$/g, ''),
}));
const rowByMigration = new Map(
  inventoryRows.map((row) => [row.migration, row])
);

function rollbackLocations(migration) {
  const rollback = migration.replace(/\.sql$/, '_down.sql');
  return rollbackFilesByDirectory
    .filter(({ files }) => files.includes(rollback))
    .map(({ location }) => location);
}

function summaryCount(name, pattern) {
  const match = inventory.match(pattern);
  assert.ok(match, `inventory summary is missing the ${name} count`);
  return Number(match[1]);
}

test('every migration has exactly one inventory row', () => {
  const rowCounts = new Map();
  for (const { migration } of inventoryRows) {
    rowCounts.set(migration, (rowCounts.get(migration) ?? 0) + 1);
  }
  const missingRows = migrationFiles.filter((migration) => !rowByMigration.has(migration));
  const duplicateRows = [...rowCounts]
    .filter(([, count]) => count > 1)
    .map(([migration]) => migration);

  assert.deepEqual(
    missingRows,
    [],
    `inventory is missing migration row(s): ${missingRows.join(', ')}`
  );
  assert.deepEqual(
    duplicateRows,
    [],
    `inventory has duplicate migration row(s): ${duplicateRows.join(', ')}`
  );
});

test('every inventory row names a migration on disk', () => {
  const staleRows = inventoryRows
    .map(({ migration }) => migration)
    .filter((migration) => !migrationFiles.includes(migration));

  assert.deepEqual(
    staleRows,
    [],
    `inventory has stale migration row(s): ${staleRows.join(', ')}`
  );
});

test('every inventory row uses an allowed Status value', () => {
  const allowedStatuses = new Set([
    'paired',
    'unpaired',
    'irreversible-by-design',
  ]);
  const invalidRows = inventoryRows
    .filter(({ status }) => !allowedStatuses.has(status))
    .map(({ migration, status }) => `${migration} (${status})`);

  assert.deepEqual(
    invalidRows,
    [],
    `inventory row(s) have an invalid Status: ${invalidRows.join(', ')}`
  );
});

test('paired inventory rows have a rollback file', () => {
  const missingRollbacks = inventoryRows
    .filter(({ status }) => status === 'paired')
    .filter(({ migration }) => rollbackLocations(migration).length === 0)
    .map(({ migration }) => migration);

  assert.deepEqual(
    missingRollbacks,
    [],
    `paired migration row(s) have no rollback file: ${missingRollbacks.join(', ')}`
  );
});

test('unpaired inventory rows do not have a rollback file', () => {
  const contradictoryRows = inventoryRows
    .filter(({ status }) =>
      status === 'unpaired' || status === 'irreversible-by-design'
    )
    .filter(({ migration }) => rollbackLocations(migration).length > 0)
    .map(({ migration }) => migration);

  assert.deepEqual(
    contradictoryRows,
    [],
    `unpaired migration row(s) have a rollback file: ${contradictoryRows.join(', ')}`
  );
});

test('paired inventory rows name the rollback directory on disk', () => {
  const wrongLocations = inventoryRows
    .filter(({ status }) => status === 'paired')
    .map((row) => ({ ...row, actual: rollbackLocations(row.migration) }))
    .filter(({ location, actual }) =>
      actual.length > 0 && (actual.length !== 1 || actual[0] !== location)
    )
    .map(
      ({ migration, location, actual }) =>
        `${migration} (inventory: ${location}; disk: ${actual.join(', ')})`
    );

  assert.deepEqual(
    wrongLocations,
    [],
    `paired migration row(s) name the wrong rollback location: ${wrongLocations.join('; ')}`
  );
});

test('inventory summary counts match the filesystem', () => {
  const documentedForward = summaryCount(
    'forward-migration total',
    /^The repository contains \*\*(\d+)\*\* forward migrations\. By the\r?$/m
  );
  const documentedPaired = summaryCount(
    'paired total',
    /^\*\*(\d+) are paired\*\* and \*\*\d+ lack a paired down-file\*\*\.\r?$/m
  );
  const documentedUnpaired = summaryCount(
    'unpaired total',
    /^\*\*\d+ are paired\*\* and \*\*(\d+) lack a paired down-file\*\*\.\r?$/m
  );
  const documentedPrimaryRollbacks = summaryCount(
    'supabase/rollbacks/ file total',
    /^`supabase\/rollbacks\/` contains \*\*(\d+)\*\* files, and\r?$/m
  );
  const documentedNestedRollbacks = summaryCount(
    'supabase/migrations/rollbacks/ file total',
    /^`supabase\/migrations\/rollbacks\/` contains \*\*(\d+)\*\* files\. There are \*\*\d+ orphan\*\*\r?$/m
  );
  const documentedOrphans = summaryCount(
    'orphan rollback total',
    /^`supabase\/migrations\/rollbacks\/` contains \*\*\d+\*\* files\. There are \*\*(\d+) orphan\*\*\r?$/m
  );
  const documentedDuplicates = summaryCount(
    'duplicate rollback total',
    /^rollback files and \*\*(\d+) duplicate\*\* rollback files across the two directories\.\r?$/m
  );
  const pairedOnDisk = migrationFiles.filter(
    (migration) => rollbackLocations(migration).length > 0
  ).length;
  const rollbackCounts = new Map();
  for (const { files } of rollbackFilesByDirectory) {
    for (const rollback of files) {
      rollbackCounts.set(rollback, (rollbackCounts.get(rollback) ?? 0) + 1);
    }
  }
  const orphanRollbacks = [...rollbackCounts.keys()].filter((rollback) => {
    const migration = rollback.replace(/_down\.sql$/, '.sql');
    return !migrationFiles.includes(migration);
  }).length;
  const duplicateRollbacks = [...rollbackCounts.values()].filter(
    (count) => count > 1
  ).length;
  const checks = [
    ['forward-migration total', documentedForward, migrationFiles.length],
    ['paired total', documentedPaired, pairedOnDisk],
    ['unpaired total', documentedUnpaired, migrationFiles.length - pairedOnDisk],
    [
      'supabase/rollbacks/ file total',
      documentedPrimaryRollbacks,
      rollbackFilesByDirectory[0].files.length,
    ],
    [
      'supabase/migrations/rollbacks/ file total',
      documentedNestedRollbacks,
      rollbackFilesByDirectory[1].files.length,
    ],
    ['orphan rollback total', documentedOrphans, orphanRollbacks],
    ['duplicate rollback total', documentedDuplicates, duplicateRollbacks],
  ];
  const staleCounts = checks
    .filter(([, documented, actual]) => documented !== actual)
    .map(
      ([name, documented, actual]) =>
        `${name} (inventory: ${documented}; disk: ${actual})`
    );

  assert.deepEqual(
    staleCounts,
    [],
    `inventory summary has stale count(s): ${staleCounts.join('; ')}`
  );
});
