import {
  probeStagingSchema,
  requireResult,
  resolveFixtureUsers,
} from './service-client.mjs';

const LEGAL_COLUMN_BY_TYPE = Object.freeze({
  terms: 'terms_version',
  privacy: 'privacy_version',
  medical_disclaimer: 'medical_disclaimer_version',
  health_data_consent: 'health_data_consent_version',
  refund: 'refund_policy_version',
  cookie: 'cookie_policy_version',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function acceptanceMatches(acceptance, documents) {
  return documents.every((document) => {
    const column = LEGAL_COLUMN_BY_TYPE[document.doc_type];
    return column && acceptance[column] === document.version;
  });
}

export async function verifyFixtures(
  contract,
  client,
  env = process.env,
  knownUsers = null
) {
  await probeStagingSchema(client, contract, env);
  const users = knownUsers || await resolveFixtureUsers(client, contract, env);
  const fixtureIds = Object.values(users).map(({ id }) => id);

  const profileResult = await client
    .from('profiles')
    .select('id,role,assigned_coach,full_name,onboarding_completed_at')
    .in('id', fixtureIds);
  const profiles = requireResult(profileResult, contract, 'profile verification', env) || [];
  assert(profiles.length === 5, 'Fixture verification expected five profiles.');

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  for (const { id, fixture } of Object.values(users)) {
    const profile = profileById.get(id);
    assert(profile, `${fixture.label} profile is missing.`);
    assert(profile.role === fixture.role, `${fixture.label} profile role is incorrect.`);
    assert(profile.full_name === fixture.fullName, `${fixture.label} profile name is incorrect.`);
  }

  const coachId = users.coach.id;
  for (const key of ['activeClient', 'inactiveClient']) {
    assert(
      profileById.get(users[key].id)?.assigned_coach === coachId,
      `${users[key].fixture.label} is not assigned to the fixture coach.`
    );
  }
  assert(
    profileById.get(users.unassignedClient.id)?.assigned_coach === null,
    'Unassigned client fixture must not have an assigned coach.'
  );
  assert(
    Boolean(profileById.get(coachId)?.onboarding_completed_at),
    'Coach onboarding must be completed for deterministic smoke.'
  );

  const coachPackageResult = await client
    .from('coach_subscriptions')
    .select('coach_id,package_key,client_limit,status')
    .eq('coach_id', coachId);
  const coachPackages = requireResult(
    coachPackageResult,
    contract,
    'coach package verification',
    env
  ) || [];
  assert(coachPackages.length === 1, 'Fixture coach must have exactly one package row.');
  assert(
    coachPackages[0].package_key === 'growth'
      && coachPackages[0].client_limit === 10
      && coachPackages[0].status === 'active',
    'Fixture coach package is not the expected active growth package.'
  );

  const documentResult = await client
    .from('legal_documents')
    .select('doc_type,version,is_required')
    .eq('is_current', true);
  const documents = requireResult(
    documentResult,
    contract,
    'legal document verification',
    env
  ) || [];
  const requiredDocuments = documents.filter((document) => document.is_required);
  assert(requiredDocuments.length > 0, 'No current required legal documents exist.');

  const acceptanceResult = await client
    .from('legal_acceptances')
    .select([
      'user_id',
      'acceptance_source',
      'role_at_acceptance',
      ...Object.values(LEGAL_COLUMN_BY_TYPE),
    ].join(','))
    .in('user_id', fixtureIds);
  const acceptances = requireResult(
    acceptanceResult,
    contract,
    'legal acceptance verification',
    env
  ) || [];

  for (const { id, fixture } of Object.values(users)) {
    const matching = acceptances.some(
      (acceptance) => acceptance.user_id === id
        && acceptance.acceptance_source === 'admin_seed'
        && acceptance.role_at_acceptance === fixture.role
        && acceptanceMatches(acceptance, requiredDocuments)
    );
    assert(matching, `${fixture.label} is missing current seeded legal acceptance.`);
  }

  const clientIds = [
    users.activeClient.id,
    users.inactiveClient.id,
    users.unassignedClient.id,
  ];
  const subscriptionResult = await client
    .from('subscriptions')
    .select('client_id,status,plan,start_date,end_date,grace_days')
    .in('client_id', clientIds);
  const subscriptions = requireResult(
    subscriptionResult,
    contract,
    'subscription verification',
    env
  ) || [];
  assert(subscriptions.length === 2, 'Fixture clients must have exactly two subscription rows.');
  for (const clientId of [users.activeClient.id, users.inactiveClient.id]) {
    assert(
      subscriptions.filter((row) => row.client_id === clientId).length === 1,
      'Each fixture client must have exactly one subscription row.'
    );
  }
  assert(
    subscriptions.every((row) => row.client_id !== users.unassignedClient.id),
    'Unassigned client fixture must not have a baseline subscription.'
  );

  const effectiveResult = await client
    .from('v_client_subscription_state')
    .select('client_id,effective_status')
    .in('client_id', clientIds);
  const effectiveRows = requireResult(
    effectiveResult,
    contract,
    'effective subscription verification',
    env
  ) || [];
  const effectiveByClient = new Map(
    effectiveRows.map((row) => [row.client_id, row.effective_status])
  );
  assert(
    effectiveByClient.get(users.activeClient.id) === 'active',
    'Active client fixture does not resolve to active.'
  );
  assert(
    effectiveByClient.get(users.inactiveClient.id) === 'expired',
    'Inactive client fixture does not resolve to expired.'
  );

  return {
    verified: true,
    roles: contract.fixtures.map((fixture) => fixture.label),
  };
}
