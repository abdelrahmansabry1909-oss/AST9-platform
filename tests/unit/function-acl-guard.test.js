import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const BASELINE = new URL('supabase/baseline/production_public_schema.sql', ROOT);
const MIGRATIONS = new URL('supabase/migrations/', ROOT);
const MANIFEST = new URL('tests/acl-expectations.json', ROOT);
const API_ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const ACL_CONTRACT_FINGERPRINT =
  'aba5d1f7fde460d64eb0ec1abf9c255a0ae6168a4854d908d9b6c9d6509809f2';

function canonicalizeType(type) {
  return type
    .replace(/"/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?:int|int4)\b/g, 'integer')
    .replace(/\bint2\b/g, 'smallint')
    .replace(/\bint8\b/g, 'bigint')
    .replace(/\bfloat4\b/g, 'real')
    .replace(/\bfloat8\b/g, 'double precision')
    .replace(/\bdecimal\b/g, 'numeric')
    .replace(/\b(?:bool)\b/g, 'boolean')
    .replace(/\btimestamptz\b/g, 'timestamp with time zone')
    .replace(/\btimestamp\s+without\s+time\s+zone\b/g, 'timestamp')
    .replace(/\btimetz\b/g, 'time with time zone')
    .replace(/\btime\s+without\s+time\s+zone\b/g, 'time')
    .replace(/\bvarchar\b/g, 'character varying')
    .replace(/\bchar\b/g, 'character')
    .replace(/\s*\[\s*\]/g, '[]');
}

function splitArguments(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (singleQuoted) {
      if (char === "'" && text[i + 1] === "'") i += 1;
      else if (char === "'") singleQuoted = false;
      continue;
    }
    if (doubleQuoted) {
      if (char === '"' && text[i + 1] === '"') i += 1;
      else if (char === '"') doubleQuoted = false;
      continue;
    }
    if (char === "'") singleQuoted = true;
    else if (char === '"') doubleQuoted = true;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (text.trim()) parts.push(text.slice(start));
  return parts;
}

function normalizeSignature(signature) {
  const openIndex = signature.indexOf('(');
  assert.ok(openIndex > 0 && signature.endsWith(')'), `${signature}: invalid signature`);
  const name = signature.slice(0, openIndex).replace(/"/g, '').trim().toLowerCase();
  const argumentsList = splitArguments(signature.slice(openIndex + 1, -1))
    .map(canonicalizeType);
  return `${name}(${argumentsList.join(', ')})`;
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObjectKeys(value[key])])
    );
  }
  return value;
}

function aclContractFingerprint(entries) {
  const contract = entries
    .map((entry) =>
      sortObjectKeys({
        signature: normalizeSignature(entry.signature),
        security: entry.security,
        expected: entry.expected,
      })
    )
    .sort((left, right) =>
      left.signature < right.signature ? -1 : left.signature > right.signature ? 1 : 0
    );
  return createHash('sha256').update(JSON.stringify(contract), 'utf8').digest('hex');
}

function stripDefault(argument) {
  let depth = 0;
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let i = 0; i < argument.length; i += 1) {
    const char = argument[i];
    if (singleQuoted) {
      if (char === "'" && argument[i + 1] === "'") i += 1;
      else if (char === "'") singleQuoted = false;
      continue;
    }
    if (doubleQuoted) {
      if (char === '"' && argument[i + 1] === '"') i += 1;
      else if (char === '"') doubleQuoted = false;
      continue;
    }
    if (char === "'") singleQuoted = true;
    else if (char === '"') doubleQuoted = true;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (depth === 0) {
      const tail = argument.slice(i);
      const match = tail.match(/^(?:\s+DEFAULT\b|\s*=\s*)/i);
      if (match) return argument.slice(0, i);
    }
  }
  return argument;
}

function normalizeCreateArgument(argument) {
  return canonicalizeType(stripDefault(argument));
}

function argumentType(argument, hasNames) {
  let normalized = normalizeCreateArgument(argument);
  normalized = normalized.replace(/^(?:inout|in|out|variadic)\s+/, '');
  if (!hasNames) return normalized;

  const firstSpace = normalized.indexOf(' ');
  assert.notEqual(firstSpace, -1, `cannot identify argument type in "${argument.trim()}"`);
  return normalized.slice(firstSpace + 1);
}

function findClosingParen(sql, openIndex) {
  let depth = 0;
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let i = openIndex; i < sql.length; i += 1) {
    const char = sql[i];
    if (singleQuoted) {
      if (char === "'" && sql[i + 1] === "'") i += 1;
      else if (char === "'") singleQuoted = false;
      continue;
    }
    if (doubleQuoted) {
      if (char === '"' && sql[i + 1] === '"') i += 1;
      else if (char === '"') doubleQuoted = false;
      continue;
    }
    if (char === "'") singleQuoted = true;
    else if (char === '"') doubleQuoted = true;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unterminated function argument list at offset ${openIndex}`);
}

function maskNonCode(sql) {
  const masked = sql.split('');
  const blank = (index) => {
    if (masked[index] !== '\n' && masked[index] !== '\r') masked[index] = ' ';
  };

  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') {
        blank(i);
        i += 1;
      }
    } else if (sql.startsWith('/*', i)) {
      blank(i);
      blank(i + 1);
      i += 2;
      while (i < sql.length && !sql.startsWith('*/', i)) {
        blank(i);
        i += 1;
      }
      blank(i);
      blank(i + 1);
      i += 1;
    } else if (sql[i] === "'") {
      blank(i);
      i += 1;
      while (i < sql.length) {
        blank(i);
        if (sql[i] === "'" && sql[i + 1] === "'") {
          blank(i + 1);
          i += 2;
        } else if (sql[i] === "'") {
          break;
        } else {
          i += 1;
        }
      }
    } else if (sql[i] === '$') {
      const tag = sql.slice(i).match(/^\$[a-z_][a-z0-9_]*\$|^\$\$/i)?.[0];
      if (!tag) continue;
      const closing = sql.indexOf(tag, i + tag.length);
      if (closing === -1) continue;
      const end = closing + tag.length;
      while (i < end) {
        blank(i);
        i += 1;
      }
      i -= 1;
    }
  }
  return masked.join('');
}

function parseEvents(sql, source) {
  const events = [];
  const code = maskNonCode(sql);
  const publicName = String.raw`(?:"public"|public)\s*\.\s*(?:"([^"]+)"|([a-z_][a-z0-9_$]*))`;
  const createPattern = new RegExp(
    String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+${publicName}\s*\(`,
    'gi'
  );
  const dropPattern = new RegExp(
    String.raw`\bdrop\s+function\s+(?:if\s+exists\s+)?${publicName}\s*\(`,
    'gi'
  );

  for (const match of code.matchAll(createPattern)) {
    const name = (match[1] || match[2]).toLowerCase();
    const openIndex = match.index + match[0].lastIndexOf('(');
    const closeIndex = findClosingParen(sql, openIndex);
    const rawArguments = sql.slice(openIndex + 1, closeIndex);
    const argumentsList = splitArguments(rawArguments);
    const normalizedArguments = argumentsList.map(normalizeCreateArgument);
    const types = argumentsList.map((argument) => argumentType(argument, true));
    const statementEnd = code.indexOf(';', closeIndex + 1);
    assert.notEqual(statementEnd, -1, `${source}: ${name} declaration is unterminated`);
    const header = code.slice(closeIndex + 1, statementEnd);
    events.push({
      position: match.index,
      action: 'create',
      identity: `${name}(${types.join(', ')})`,
      signature: `${name}(${normalizedArguments.join(', ')})`,
      name,
      security: /\bSECURITY\s+DEFINER\b/i.test(header) ? 'DEFINER' : 'INVOKER',
      source,
    });
  }

  for (const match of code.matchAll(dropPattern)) {
    const name = (match[1] || match[2]).toLowerCase();
    const openIndex = match.index + match[0].lastIndexOf('(');
    const closeIndex = findClosingParen(sql, openIndex);
    const types = splitArguments(sql.slice(openIndex + 1, closeIndex))
      .map((argument) => argumentType(argument, false));
    events.push({
      position: match.index,
      action: 'drop',
      identity: `${name}(${types.join(', ')})`,
    });
  }

  return events.sort((left, right) => left.position - right.position);
}

function buildInventory() {
  const inventory = new Map();
  const sources = [
    ['baseline', BASELINE],
    ...readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => [entry.name, new URL(entry.name, MIGRATIONS)])
      .sort(([left], [right]) => left.localeCompare(right)),
  ];

  for (const [source, url] of sources) {
    const sql = readFileSync(url, 'utf8');
    for (const event of parseEvents(sql, source)) {
      if (event.action === 'drop') inventory.delete(event.identity);
      else inventory.set(event.identity, event);
    }
  }
  return [...inventory.values()].sort((left, right) =>
    left.signature.localeCompare(right.signature)
  );
}

function loadManifest() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (error) {
    assert.fail(`tests/acl-expectations.json is not valid JSON: ${error.message}`);
  }
  assert.ok(Array.isArray(parsed), 'tests/acl-expectations.json must contain an array');
  return parsed;
}

test('manifest is structurally complete and has unique signatures', () => {
  const entries = loadManifest();
  const seen = new Set();

  for (const entry of entries) {
    const label = entry?.signature ?? '<missing signature>';
    assert.equal(typeof entry?.signature, 'string', `${label}: signature must be a string`);
    assert.ok(entry.signature.length > 0, `${label}: signature must not be empty`);
    assert.ok(!seen.has(entry.signature), `${label}: duplicate manifest signature`);
    seen.add(entry.signature);
    assert.equal(typeof entry.name, 'string', `${label}: name must be a string`);
    assert.ok(entry.name.length > 0, `${label}: name must not be empty`);
    assert.ok(
      entry.signature.startsWith(`${entry.name}(`),
      `${label}: name does not match signature`
    );
    assert.ok(
      entry.security === 'DEFINER' || entry.security === 'INVOKER',
      `${label}: security must be exactly DEFINER or INVOKER`
    );
    assert.equal(typeof entry.expected, 'object', `${label}: expected grants must be an object`);
    assert.ok(entry.expected !== null, `${label}: expected grants must not be null`);
    assert.deepEqual(
      Object.keys(entry.expected).sort(),
      [...API_ROLES].sort(),
      `${label}: expected grants must pin exactly ${API_ROLES.join(', ')}`
    );
    for (const role of API_ROLES) {
      assert.equal(
        typeof entry.expected[role],
        'boolean',
        `${label}: expected.${role} must be boolean`
      );
    }
    assert.equal(
      entry.expected.PUBLIC,
      false,
      `${label}: granting EXECUTE to PUBLIC is never intended`
    );
    assert.equal(typeof entry.rationale, 'string', `${label}: rationale must be a string`);
    assert.ok(entry.rationale.trim(), `${label}: rationale must not be empty`);
    assert.equal(typeof entry.source, 'string', `${label}: source must be a string`);
    assert.ok(entry.source.trim(), `${label}: source must not be empty`);
    assert.ok(
      entry.confidence === 'high' || entry.confidence === 'low',
      `${label}: confidence must be exactly high or low`
    );
    assert.ok(
      entry.decision === 'approved' || entry.decision === 'provisional',
      `${label}: decision must be exactly approved or provisional`
    );
    assert.equal(
      entry.decision,
      entry.confidence === 'high' ? 'approved' : 'provisional',
      `${label}: decision must match confidence`
    );
    if (entry.decision === 'provisional') {
      assert.equal(typeof entry.ambiguity, 'string', `${label}: provisional entry needs ambiguity`);
      assert.ok(entry.ambiguity.trim(), `${label}: ambiguity must not be empty`);
      assert.equal(
        typeof entry.recommendation,
        'object',
        `${label}: provisional entry needs a recommendation object`
      );
      assert.ok(entry.recommendation !== null, `${label}: recommendation must not be null`);
      for (const role of API_ROLES) {
        assert.equal(
          typeof entry.recommendation[role],
          'string',
          `${label}: recommendation.${role} must be a string`
        );
        assert.ok(
          entry.recommendation[role].trim(),
          `${label}: recommendation.${role} must not be empty`
        );
      }
      assert.equal(
        entry.blocks_remediation,
        true,
        `${label}: provisional entries must block remediation`
      );
    }
  }
});

test('ACL contract fingerprint detects any pinned grant change', () => {
  const actual = aclContractFingerprint(loadManifest());
  assert.equal(
    actual,
    ACL_CONTRACT_FINGERPRINT,
    `ACL contract changes are intentional only when ACL_CONTRACT_FINGERPRINT is updated in the same commit; expected ${ACL_CONTRACT_FINGERPRINT}, actual ${actual}`
  );
});

const provisionalSignatures = loadManifest()
  .filter((entry) => entry.decision === 'provisional')
  .map((entry) => normalizeSignature(entry.signature))
  .sort();

test(`provisional ACL decisions block remediation: ${provisionalSignatures.join(', ')}`, () => {
  // The three trigger helpers were promoted to approved on 2026-07-30: each is
  // reached only through CREATE TRIGGER, and PostgreSQL does not require the DML
  // user to hold EXECUTE on a trigger function. Only the role predicates remain
  // provisional, all on the single unresolved question of service_role.
  assert.deepEqual(provisionalSignatures, [
    'get_my_role()',
    'is_admin()',
    'is_admin_or_coach()',
    'is_coach()',
    'is_coach_or_admin()',
  ]);
});

test('manifest signatures exactly match the effective repository inventory', () => {
  const inventory = buildInventory();
  const entries = loadManifest();
  const repositoryBySignature = new Map(
    inventory.map((entry) => [entry.signature, entry])
  );
  const manifestBySignature = new Map(
    entries.map((entry) => [entry.signature, entry])
  );

  for (const entry of inventory) {
    assert.ok(
      manifestBySignature.has(entry.signature),
      `${entry.signature}: repository function is missing from ACL manifest`
    );
  }
  for (const entry of entries) {
    assert.ok(
      repositoryBySignature.has(entry.signature),
      `${entry.signature}: manifest function is not declared by the repository`
    );
  }
});

test('manifest security and defining source match the effective declarations', () => {
  const inventory = buildInventory();
  const manifestBySignature = new Map(
    loadManifest().map((entry) => [entry.signature, entry])
  );

  for (const declaration of inventory) {
    const entry = manifestBySignature.get(declaration.signature);
    assert.equal(
      entry.security,
      declaration.security,
      `${declaration.signature}: manifest security differs from repository declaration`
    );
    assert.equal(
      entry.source,
      declaration.source,
      `${declaration.signature}: manifest source differs from effective defining source`
    );
  }
});
