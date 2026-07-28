import {
  createFixtureContract,
  fixtureLabels,
  redactFixtureError,
  STAGING_COMMANDS,
} from './fixture-contract.mjs';

function printSuccess(command, roles) {
  process.stdout.write(
    `Staging fixture ${command} passed for roles: ${roles.join(', ')}.\n`
  );
}

// Case names only. Fixture emails, ids, and server payloads are never printed.
function printCaseOutcomes(command, results) {
  const allowed = results.filter(({ outcome }) => outcome === 'allowed').length;
  const denied = results.length - allowed;
  for (const { name, outcome } of results) {
    process.stdout.write(`  ${outcome === 'allowed' ? 'allowed' : 'denied '}  ${name}\n`);
  }
  process.stdout.write(
    `Staging ${command} passed ${results.length} cases (${allowed} allowed, ${denied} denied).\n`
  );
}

let activeContract = null;

async function run() {
  const [command, ...extra] = process.argv.slice(2);
  if (!command || extra.length > 0 || !STAGING_COMMANDS.includes(command)) {
    throw new Error(`Usage: node tests/staging/cli.mjs <${STAGING_COMMANDS.join('|')}>`);
  }

  const contract = createFixtureContract(process.env, command);
  activeContract = contract;
  if (command === 'validate') {
    printSuccess(command, fixtureLabels(contract));
    return;
  }

  const { createStagingServiceClient } = await import('./service-client.mjs');
  const client = createStagingServiceClient(contract, process.env);

  if (command === 'seed') {
    const { seedFixtures } = await import('./seed.mjs');
    const result = await seedFixtures(contract, client, process.env);
    printSuccess(command, result.roles);
    return;
  }

  if (command === 'verify') {
    const { verifyFixtures } = await import('./verify.mjs');
    const result = await verifyFixtures(contract, client, process.env);
    printSuccess(command, result.roles);
    return;
  }

  if (command === 'authz-subscriptions') {
    const { runSubscriptionWriteSuite } = await import('./subscription-writes.mjs');
    const results = await runSubscriptionWriteSuite(contract, client, process.env);
    printCaseOutcomes(command, results);
    return;
  }

  if (command === 'authz-system-rpcs') {
    const { runSystemRpcBoundarySuite } = await import('./system-rpc-boundaries.mjs');
    const results = await runSystemRpcBoundarySuite(contract, client, process.env);
    printCaseOutcomes(command, results);
    return;
  }

  if (command !== 'reset') {
    throw new Error(`Staging command has no handler: ${command}`);
  }

  const { resetFixtures } = await import('./reset.mjs');
  const result = await resetFixtures(contract, client, process.env);
  printSuccess(command, result.roles);
}

run().catch((error) => {
  const message = redactFixtureError(
    error,
    activeContract,
    process.env,
    'staging fixture command'
  );
  process.stderr.write(`${message.message}\n`);
  process.exitCode = 1;
});
