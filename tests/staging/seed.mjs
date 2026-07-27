import {
  deleteScoped,
  ensureFixtureUsers,
  probeStagingSchema,
  requireResult,
} from './service-client.mjs';
import { verifyFixtures } from './verify.mjs';

const LEGAL_COLUMN_BY_TYPE = Object.freeze({
  terms: 'terms_version',
  privacy: 'privacy_version',
  medical_disclaimer: 'medical_disclaimer_version',
  health_data_consent: 'health_data_consent_version',
  refund: 'refund_policy_version',
  cookie: 'cookie_policy_version',
});

function isoDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function legalVersions(documents) {
  return Object.fromEntries(
    documents
      .map((document) => [LEGAL_COLUMN_BY_TYPE[document.doc_type], document.version])
      .filter(([column]) => Boolean(column))
  );
}

function hasMatchingAcceptance(rows, versions, role) {
  return rows.some((row) =>
    row.acceptance_source === 'admin_seed'
    && row.role_at_acceptance === role
    && Object.entries(versions).every(([column, version]) => row[column] === version)
  );
}

export async function seedFixtures(contract, client, env = process.env) {
  await probeStagingSchema(client, contract, env);
  const users = await ensureFixtureUsers(client, contract, env);
  const now = new Date().toISOString();
  const coachId = users.coach.id;

  const profiles = Object.values(users).map(({ id, fixture }) => ({
    id,
    email: fixture.email,
    full_name: fixture.fullName,
    role: fixture.role,
    current_phase: 'Phase 1',
    assigned_coach:
      fixture.key === 'activeClient' || fixture.key === 'inactiveClient'
        ? coachId
        : null,
    onboarding_completed_at:
      fixture.role === 'admin' || fixture.role === 'coach' ? now : null,
  }));
  const profileResult = await client
    .from('profiles')
    .upsert(profiles, { onConflict: 'id' });
  requireResult(profileResult, contract, 'profile reconcile', env);

  const coachPackageResult = await client.from('coach_subscriptions').upsert({
    coach_id: coachId,
    package_key: 'growth',
    client_limit: 10,
    custom_qty: null,
    status: 'active',
    billing_interval: 'monthly',
    notes: 'deterministic staging fixture',
    created_by: users.admin.id,
  }, { onConflict: 'coach_id' });
  requireResult(coachPackageResult, contract, 'coach package reconcile', env);

  const documentResult = await client
    .from('legal_documents')
    .select('doc_type,version,is_required')
    .eq('is_current', true);
  const documents = requireResult(documentResult, contract, 'legal document read', env) || [];
  if (!documents.some((document) => document.is_required)) {
    throw new Error('Staging schema has no current required legal documents.');
  }
  const versions = legalVersions(documents);
  const legalColumns = Object.values(LEGAL_COLUMN_BY_TYPE).join(',');

  for (const { id, fixture } of Object.values(users)) {
    const existingResult = await client
      .from('legal_acceptances')
      .select(`acceptance_source,role_at_acceptance,${legalColumns}`)
      .eq('user_id', id);
    const existing = requireResult(
      existingResult,
      contract,
      `${fixture.label} legal acceptance read`,
      env
    ) || [];

    if (!hasMatchingAcceptance(existing, versions, fixture.role)) {
      const insertResult = await client.from('legal_acceptances').insert({
        user_id: id,
        acceptance_source: 'admin_seed',
        role_at_acceptance: fixture.role,
        ...versions,
      });
      requireResult(
        insertResult,
        contract,
        `${fixture.label} legal acceptance seed`,
        env
      );
    }
  }

  const clientIds = [
    users.activeClient.id,
    users.inactiveClient.id,
    users.unassignedClient.id,
  ];
  await deleteScoped(
    client,
    contract,
    'subscriptions',
    'client_id',
    clientIds,
    env
  );

  const insertSubscriptions = await client.from('subscriptions').insert([
    {
      client_id: users.activeClient.id,
      plan_name: 'AST9 E2E Active',
      plan: 12,
      start_date: isoDate(-1),
      end_date: isoDate(365),
      status: 'active',
      grace_days: 7,
      notes: 'deterministic active staging fixture',
      created_by: users.admin.id,
    },
    {
      client_id: users.inactiveClient.id,
      plan_name: 'AST9 E2E Expired',
      plan: 1,
      start_date: isoDate(-90),
      end_date: isoDate(-60),
      status: 'expired',
      grace_days: 0,
      notes: 'deterministic inactive staging fixture',
      created_by: users.admin.id,
    },
  ]);
  requireResult(insertSubscriptions, contract, 'fixture subscription seed', env);

  return verifyFixtures(contract, client, env, users);
}
