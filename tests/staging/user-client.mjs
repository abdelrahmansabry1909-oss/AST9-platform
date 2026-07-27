import { createClient } from '@supabase/supabase-js';
import { assertMutationBoundary, redactFixtureError } from './fixture-contract.mjs';

// Authenticated fixture sessions deliberately use the ANON key, never the
// service-role key. A service-role client bypasses RLS and SECURITY DEFINER
// authorization entirely, so it would report every case as allowed and prove
// nothing. These clients travel the same PostgREST path the browser uses.
export function createFixtureUserClient(contract) {
  return createClient(contract.config.url, contract.config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-ast9-purpose': 'staging-authz-tooling' },
    },
  });
}

// Signed-out caller used to prove the RPCs carry no anon EXECUTE grant.
export function createAnonymousClient(contract, env = process.env) {
  assertMutationBoundary(contract, env);
  return createFixtureUserClient(contract);
}

export async function signInFixture(contract, fixtureKey, env = process.env) {
  assertMutationBoundary(contract, env);

  const fixture = contract.fixtureByKey[fixtureKey];
  if (!fixture) {
    throw new Error(`Unknown staging fixture key: ${fixtureKey}`);
  }

  const client = createFixtureUserClient(contract);
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  if (error) {
    throw redactFixtureError(error, contract, env, `${fixture.label} sign-in`);
  }
  if (!data?.user?.id) {
    throw new Error(`${fixture.label} sign-in returned no authenticated user.`);
  }

  return { client, userId: data.user.id, fixture };
}

export async function signOutFixture(session) {
  if (!session?.client) return;
  await session.client.auth.signOut();
}
