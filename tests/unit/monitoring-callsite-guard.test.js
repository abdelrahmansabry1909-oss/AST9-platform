/*
 * Static observability guard: checks captureIssue call-site argument syntax,
 * live call sites, privacy-contract markers, and ops-health status capture.
 * It does not prove that an event reaches Sentry, that any monitored path runs,
 * or that a Sentry alert rule exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const monitoringPath = new URL('js/monitoring.js', root);
const workflowPath = new URL('.github/workflows/ops-health.yml', root);

function sourceFiles(relativeDirectory) {
  const directory = new URL(relativeDirectory, root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${relativePath}/`);
    return /\.(?:html|js)$/.test(entry.name) ? [relativePath] : [];
  });
}

function skipQuoted(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipComment(source, start) {
  if (source[start + 1] === '/') {
    const end = source.indexOf('\n', start + 2);
    return end === -1 ? source.length : end + 1;
  }
  if (source[start + 1] === '*') {
    const end = source.indexOf('*/', start + 2);
    return end === -1 ? source.length : end + 2;
  }
  return start;
}

function matchingParen(source, open) {
  let depth = 1;
  for (let i = open + 1; i < source.length;) {
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      i = skipQuoted(source, i);
    } else if (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      i = skipComment(source, i);
    } else {
      if (source[i] === '(') depth++;
      if (source[i] === ')' && --depth === 0) return i;
      i++;
    }
  }
  return -1;
}

function splitArguments(source) {
  const args = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  for (let i = 0; i < source.length;) {
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      i = skipQuoted(source, i);
      continue;
    }
    if (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      i = skipComment(source, i);
      continue;
    }
    if (source[i] === '(') round++;
    else if (source[i] === ')') round--;
    else if (source[i] === '[') square++;
    else if (source[i] === ']') square--;
    else if (source[i] === '{') curly++;
    else if (source[i] === '}') curly--;
    else if (source[i] === ',' && round === 0 && square === 0 && curly === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  args.push(source.slice(start).trim());
  return args;
}

function captureCalls(source) {
  const calls = [];
  const name = 'captureIssue';
  for (let i = 0; i < source.length;) {
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      i = skipQuoted(source, i);
      continue;
    }
    if (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      i = skipComment(source, i);
      continue;
    }
    const before = source[i - 1] || '';
    const after = source[i + name.length] || '';
    if (source.startsWith(name, i) && !/[\w$]/.test(before) && !/[\w$]/.test(after)) {
      let open = i + name.length;
      while (/\s/.test(source[open] || '')) open++;
      if (source[open] === '(') {
        const close = matchingParen(source, open);
        assert.notEqual(close, -1, 'captureIssue call has no closing parenthesis');
        calls.push({ index: i, args: splitArguments(source.slice(open + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return calls;
}

function enclosesExpression(expression) {
  if (expression[0] !== '(') return false;
  return matchingParen(expression, 0) === expression.length - 1;
}

function conditionalParts(expression) {
  let round = 0;
  let square = 0;
  let curly = 0;
  let question = -1;
  let nested = 0;
  for (let i = 0; i < expression.length;) {
    if (expression[i] === "'" || expression[i] === '"' || expression[i] === '`') {
      i = skipQuoted(expression, i);
      continue;
    }
    if (expression[i] === '/' && (expression[i + 1] === '/' || expression[i + 1] === '*')) {
      i = skipComment(expression, i);
      continue;
    }
    if (expression[i] === '(') round++;
    else if (expression[i] === ')') round--;
    else if (expression[i] === '[') square++;
    else if (expression[i] === ']') square--;
    else if (expression[i] === '{') curly++;
    else if (expression[i] === '}') curly--;
    else if (round === 0 && square === 0 && curly === 0 && expression[i] === '?') {
      if (question === -1) question = i;
      else nested++;
    } else if (round === 0 && square === 0 && curly === 0 && expression[i] === ':' && question !== -1) {
      if (nested > 0) nested--;
      else return [expression.slice(question + 1, i), expression.slice(i + 1)];
    }
    i++;
  }
  return null;
}

function isLiteralChoice(expression) {
  let value = expression.trim();
  while (enclosesExpression(value)) value = value.slice(1, -1).trim();
  if (/^'(?:\\[\s\S]|[^'\\])*'$/.test(value)) return true;
  if (/^"(?:\\[\s\S]|[^"\\])*"$/.test(value)) return true;
  const parts = conditionalParts(value);
  return !!parts && parts.every(isLiteralChoice);
}

test('captureIssue call sites use only literal arguments or literal conditional branches', () => {
  const files = [...sourceFiles('js/'), ...sourceFiles('src/'), 'app.html']
    .filter((path) => path !== 'js/monitoring.js');
  const calls = files.flatMap((path) => {
    const source = readFileSync(new URL(path, root), 'utf8');
    return captureCalls(source).map((call) => ({ ...call, path }));
  });

  assert.ok(calls.length > 0, 'captureIssue has returned to zero call sites');
  for (const call of calls) {
    assert.ok(call.args.length > 0, `${call.path}: captureIssue has no arguments`);
    call.args.forEach((argument, index) => {
      assert.ok(
        isLiteralChoice(argument),
        `${call.path}: captureIssue argument ${index + 1} is not a string literal or literal-only conditional: ${argument}`
      );
    });
  }
});

test('monitoring helper retains load-bearing privacy protections', () => {
  const source = readFileSync(monitoringPath, 'utf8');

  assert.doesNotMatch(source, /\bsetUser\s*\(/);
  assert.match(source, /function\s+beforeSend\s*\(event\)/);
  assert.match(source, /beforeSend\s*:\s*beforeSend/);
  assert.match(source, /maxBreadcrumbs\s*:\s*0/);
  assert.match(source, /beforeBreadcrumb\s*:\s*function\s*\(\)\s*\{\s*return\s+null\s*;?\s*\}/);
  assert.match(source, /event\.tags\s*=\s*t\s*;/);
  const allowedTags = ['role', 'feature_area', 'app_version'];
  for (const tag of allowedTags) {
    assert.match(source, new RegExp(`event\\.tags\\.${tag}[^;]+t\\.${tag}\\s*=`));
  }
  const copiedTags = [...source.matchAll(/t\.([A-Za-z0-9_]+)\s*=\s*event\.tags\.\1/g)]
    .map(([, tag]) => tag);
  assert.deepEqual(copiedTags, allowedTags);
});

test('ops-health unreachable capture cannot concatenate curl output with fallback status', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(workflow, /\|\|\s*echo\s+['"]000['"]/);
  assert.match(workflow, /\)"\s*\|\|\s*http_code="000"/);
});
