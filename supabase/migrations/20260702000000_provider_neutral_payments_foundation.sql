-- ═══════════════════════════════════════════════════════════════
-- P2B — Provider-neutral Payments DB Foundation
-- Run in Supabase SQL Editor / via apply_migration. Additive · idempotent.
-- Rollback: migrations/rollbacks/20260702000000_provider_neutral_payments_foundation_down.sql
--
-- SCOPE (additive only): lays the provider-neutral groundwork a FUTURE
-- verified payment webhook (Paymob first — P2C/P2D) will call. This migration
-- adds NO provider code, NO SDK, NO Edge Function, NO frontend, NO live keys.
-- Manual billing (admin_set_coach_package) is UNTOUCHED and remains the
-- always-available path.
--
-- Three NEW/additive objects:
--   1. public.payment_events        — idempotency + audit ledger. Stores a
--                                      SCRUBBED summary only — NEVER the raw
--                                      webhook body, card data, tokens, secrets.
--   2. coach_subscriptions + cols    — provider-neutral billing linkage.
--   3. public.apply_paid_coach_package_period_system(...) — service-role-only
--        RPC the future webhook calls to apply a PAID coach-package period,
--        idempotent via payment_events UNIQUE(provider, provider_event_id).
--
-- WEBHOOK-AUTHORITATIVE PRINCIPLE (enforced by design): access may be granted
-- ONLY by (a) a verified provider webhook that calls the service-role RPC below,
-- or (b) an admin RPC. The frontend / a checkout redirect NEVER grants access.
--
-- Reuses the live service-role-only pattern from ops_health_snapshot_system
-- (SECURITY DEFINER, search_path pinned, EXECUTE revoked from
-- public/anon/authenticated, granted to service_role only).
--
-- NOT TOUCHED: subscriptions / v_client_subscription_state / reactivate_subscription
-- (client-access lane, deferred to P2G), admin_set_coach_package, coach_slot_status,
-- and all auth / legal / program / workout / athletic objects. No auth.users writes.
--
-- Depends on (pre-existing, live): public.coach_subscriptions (unique coach_id),
-- public.profiles(role), public.is_admin().
-- ═══════════════════════════════════════════════════════════════

-- ── 1. payment_events — idempotency + audit ledger ───────────────
-- One row per provider event. UNIQUE(provider, provider_event_id) is the single
-- idempotency guard the RPC (and future webhook) rely on. Stores ONLY a scrubbed
-- summary — never the raw webhook body, never card/PII data.
create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null
                      check (provider in ('manual','paymob','stripe')),
  provider_event_id text not null,
  event_type        text not null,
  subject_type      text not null
                      check (subject_type in ('coach_package','client_access')),
  subject_id        uuid not null,
  amount_minor      integer
                      check (amount_minor is null or amount_minor >= 0),
  currency          text
                      check (currency is null or currency ~ '^[A-Z]{3}$'),
  status            text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  scrubbed_summary  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  constraint payment_events_provider_event_uq unique (provider, provider_event_id)
);

comment on table public.payment_events is
  'Provider-neutral payment idempotency + audit ledger (P2B). One row per '
  'provider event; UNIQUE(provider, provider_event_id) is the idempotency key. '
  'scrubbed_summary holds ONLY safe, pre-scrubbed fields — NEVER the raw webhook '
  'body, card data, tokens, or secrets. Admin-read only; writes come from the '
  'service role (webhook/RPC), which bypasses RLS.';

create index if not exists payment_events_subject_idx
  on public.payment_events (subject_type, subject_id);
create index if not exists payment_events_received_idx
  on public.payment_events (received_at desc);
create index if not exists payment_events_status_idx
  on public.payment_events (status);

-- RLS: admin may read; no coach/client/anon read or write. The service role
-- (future webhook + the RPC below) bypasses RLS, so — exactly like
-- coach_subscriptions — there is deliberately NO direct write policy.
alter table public.payment_events enable row level security;

drop policy if exists "payment_events_admin_select" on public.payment_events;
create policy "payment_events_admin_select" on public.payment_events
  for select to authenticated
  using ( (select public.is_admin()) );

-- ── 2. coach_subscriptions — provider-neutral billing columns ────
-- Additive + idempotent. Existing rows default to provider='manual',
-- cancel_at_period_end=false; every other new column is nullable. package_key /
-- client_limit / status behavior is UNCHANGED. Inline CHECKs ride with
-- ADD COLUMN IF NOT EXISTS so re-runs are no-ops and rollback (drop column)
-- removes the constraint automatically.
alter table public.coach_subscriptions
  add column if not exists provider text not null default 'manual'
    check (provider in ('manual','paymob','stripe'));
alter table public.coach_subscriptions
  add column if not exists provider_customer_id text;
alter table public.coach_subscriptions
  add column if not exists provider_subscription_id text;
alter table public.coach_subscriptions
  add column if not exists current_period_end timestamptz;
alter table public.coach_subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;
alter table public.coach_subscriptions
  add column if not exists last_payment_status text;
alter table public.coach_subscriptions
  add column if not exists billing_currency text
    check (billing_currency is null or billing_currency ~ '^[A-Z]{3}$');

comment on column public.coach_subscriptions.provider is
  'Billing provider for this coach package: manual (admin-assigned, default) | '
  'paymob | stripe. Set by the verified webhook RPC; manual stays the fallback.';
comment on column public.coach_subscriptions.current_period_end is
  'Paid-through timestamp set by the verified payment webhook (P2C+). NULL for '
  'manual/admin-assigned packages (no automated period).';

-- ── 3. apply_paid_coach_package_period_system(...) ───────────────
-- The ONLY object a future verified payment webhook calls to apply a PAID
-- coach-package period. Service-role-only (mirrors ops_health_snapshot_system):
-- SECURITY DEFINER, search_path pinned, EXECUTE revoked from
-- public/anon/authenticated and granted to service_role only. No auth.uid() /
-- admin-JWT dependency (a webhook has neither). No secret handling here — HMAC
-- verification happens in the edge function BEFORE this is ever called.
--
-- Idempotent: inserts the payment_events row FIRST; a duplicate
-- (provider, provider_event_id) short-circuits with {applied:false,duplicate:true}
-- and never extends the period twice. The whole body runs in one transaction, so
-- if the coach_subscriptions upsert fails the event insert rolls back too (safe
-- to retry). Returns ONLY safe scalars — no PII, secrets, or provider payload.
create or replace function public.apply_paid_coach_package_period_system(
  p_provider          text,
  p_provider_event_id text,
  p_coach_id          uuid,
  p_package_key       text,
  p_client_limit      integer,
  p_period_start      timestamptz,
  p_period_end        timestamptz,
  p_amount_minor      integer default null,
  p_currency          text    default null,
  p_payment_status    text    default 'paid',
  p_event_type        text    default 'payment_succeeded',
  p_summary           jsonb   default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_role     text;
  v_limit    int;
  v_custom   int;
  v_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_event_id uuid;
begin
  -- Validate provider.
  if p_provider is null or p_provider not in ('manual','paymob','stripe') then
    raise exception 'invalid provider: %', coalesce(p_provider, '(null)');
  end if;
  if p_provider_event_id is null or length(p_provider_event_id) = 0 then
    raise exception 'provider_event_id required';
  end if;

  -- Validate coach exists and is a coach/admin (mirrors admin_set_coach_package).
  select role into v_role from public.profiles where id = p_coach_id;
  if v_role is null or v_role not in ('coach','admin') then
    raise exception 'target must be an existing coach or admin';
  end if;

  -- Resolve the ENFORCED client_limit from the package key (canonical rules —
  -- never trust a caller-supplied limit for a standard tier). custom uses the
  -- passed quantity (>= 60).
  if p_package_key = 'custom' then
    if p_client_limit is null or p_client_limit < 60 then
      raise exception 'custom package requires p_client_limit >= 60';
    end if;
    v_limit  := p_client_limit;
    v_custom := p_client_limit;
  else
    v_limit := case p_package_key
      when 'free'    then 1
      when 'starter' then 5
      when 'growth'  then 10
      when 'pro'     then 20
      when 'scale'   then 50
      else null end;
    if v_limit is null then
      raise exception 'unknown package_key: %', coalesce(p_package_key, '(null)');
    end if;
    v_custom := null;
  end if;

  -- Validate period.
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'p_period_end must be after p_period_start';
  end if;

  -- Idempotency: insert the event FIRST. A duplicate short-circuits.
  insert into public.payment_events
    (provider, provider_event_id, event_type, subject_type, subject_id,
     amount_minor, currency, status, scrubbed_summary)
  values
    (p_provider, p_provider_event_id, p_event_type, 'coach_package', p_coach_id,
     p_amount_minor, v_currency, p_payment_status, coalesce(p_summary, '{}'::jsonb))
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select id into v_event_id
    from public.payment_events
    where provider = p_provider and provider_event_id = p_provider_event_id;
    return jsonb_build_object(
      'applied', false, 'duplicate', true,
      'event_id', v_event_id, 'coach_id', p_coach_id);
  end if;

  -- Apply the paid period. Upsert on the unique coach_id. package_key /
  -- client_limit / status semantics match admin_set_coach_package; provider
  -- fields + current_period_end come from the (already-verified) payment.
  insert into public.coach_subscriptions
    (coach_id, package_key, client_limit, custom_qty, status,
     provider, current_period_end, cancel_at_period_end,
     last_payment_status, billing_currency, created_by)
  values
    (p_coach_id, p_package_key, v_limit, v_custom, 'active',
     p_provider, p_period_end, false,
     p_payment_status, v_currency, null)
  on conflict (coach_id) do update
    set package_key          = excluded.package_key,
        client_limit         = excluded.client_limit,
        custom_qty           = excluded.custom_qty,
        status               = 'active',
        provider             = excluded.provider,
        current_period_end   = excluded.current_period_end,
        cancel_at_period_end = false,
        last_payment_status  = excluded.last_payment_status,
        billing_currency     = excluded.billing_currency,
        updated_at           = now();

  update public.payment_events set processed_at = now() where id = v_event_id;

  return jsonb_build_object(
    'applied',            true,
    'duplicate',          false,
    'coach_id',           p_coach_id,
    'package_key',        p_package_key,
    'client_limit',       v_limit,
    'current_period_end', p_period_end,
    'event_id',           v_event_id
  );
end;
$fn$;

revoke all     on function public.apply_paid_coach_package_period_system(
  text, text, uuid, text, integer, timestamptz, timestamptz, integer, text, text, text, jsonb
) from public, anon, authenticated;
grant  execute on function public.apply_paid_coach_package_period_system(
  text, text, uuid, text, integer, timestamptz, timestamptz, integer, text, text, text, jsonb
) to service_role;

-- ── Smoke (run in a SEPARATE owner-approved apply phase; NOT run here) ────────
--   service_role → select public.apply_paid_coach_package_period_system(
--       'paymob','evt_test_1','<coach uuid>','starter',5, now(), now()+interval '1 month');
--       → { applied:true, client_limit:5, current_period_end:… }
--   same call again → { applied:false, duplicate:true, … }        (idempotent)
--   authenticated / anon → same call → permission denied           (execute revoked)
--   admin_set_coach_package + coach_slot_status STILL work unchanged (regression)
