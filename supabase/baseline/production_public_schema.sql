


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."_clamp_score"("v" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT GREATEST(0::numeric, LEAST(100::numeric, COALESCE(v, 0)));
$$;


ALTER FUNCTION "public"."_clamp_score"("v" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_profile_exists"("p_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_id);
$$;


ALTER FUNCTION "public"."_profile_exists"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_coach_business_overview"() RETURNS TABLE("coach_id" "uuid", "coach_name" "text", "coach_email" "text", "phone" "text", "country" "text", "business_name" "text", "professional_title" "text", "email_verified" boolean, "package_key" "text", "billing_interval" "text", "client_limit" integer, "custom_qty" integer, "package_status" "text", "client_count" integer, "remaining_slots" integer, "signup_date" timestamp with time zone, "onboarding_completed_at" timestamp with time zone, "is_active" boolean, "client_emails" "text"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then raise exception 'permission denied: admin only'; end if;
  return query
  select p.id, p.full_name, p.email, p.phone,
    p.country, p.business_name, p.professional_title,
    (u.email_confirmed_at is not null)             as email_verified,
    coalesce(cs.package_key, 'free')               as package_key,
    coalesce(cs.billing_interval, 'monthly')       as billing_interval,
    coalesce(cs.client_limit, 1)                   as client_limit,
    cs.custom_qty,
    coalesce(cs.status, 'active')                  as package_status,
    coalesce(cc.cnt, 0)                            as client_count,
    greatest(0, coalesce(cs.client_limit, 1) - coalesce(cc.cnt, 0)) as remaining_slots,
    p.created_at                                   as signup_date,
    p.onboarding_completed_at,
    p.is_active,
    coalesce(cc.emails, array[]::text[])           as client_emails
  from public.profiles p
  left join public.coach_subscriptions cs on cs.coach_id = p.id
  left join auth.users u on u.id = p.id
  left join lateral (
    select count(*)::int as cnt, array_agg(c.email order by c.email) as emails
    from public.profiles c
    where c.assigned_coach = p.id and c.role = 'client'
  ) cc on true
  where p.role = 'coach'
  order by p.created_at;
end; $$;


ALTER FUNCTION "public"."admin_coach_business_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_coach_package"("p_coach_id" "uuid", "p_package_key" "text", "p_custom_qty" integer DEFAULT NULL::integer, "p_notes" "text" DEFAULT NULL::"text", "p_billing_interval" "text" DEFAULT 'monthly'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_actor uuid := auth.uid(); v_role text; v_limit int; v_id uuid;
begin
  if not public.is_admin() then raise exception 'permission denied: admin only'; end if;
  if p_billing_interval not in ('monthly','annual') then
    raise exception 'billing_interval must be monthly or annual'; end if;
  select role into v_role from profiles where id = p_coach_id;
  if v_role is null or v_role not in ('coach','admin') then
    raise exception 'target must be a coach or admin'; end if;
  if p_package_key = 'custom' then
    if p_custom_qty is null or p_custom_qty < 60 then
      raise exception 'custom package requires custom_qty >= 60'; end if;
    v_limit := p_custom_qty;
  else
    v_limit := case p_package_key
      when 'free' then 1 when 'starter' then 5 when 'growth' then 10
      when 'pro' then 20 when 'scale' then 50 else null end;
    if v_limit is null then raise exception 'unknown package_key: %', p_package_key; end if;
  end if;
  insert into coach_subscriptions
    (coach_id, package_key, client_limit, custom_qty, status, notes, created_by, billing_interval)
  values (p_coach_id, p_package_key, v_limit,
     case when p_package_key = 'custom' then p_custom_qty else null end,
     'active', p_notes, v_actor, p_billing_interval)
  on conflict (coach_id) do update
    set package_key = excluded.package_key, client_limit = excluded.client_limit,
        custom_qty = excluded.custom_qty, status = 'active',
        notes = excluded.notes, created_by = excluded.created_by,
        billing_interval = excluded.billing_interval, updated_at = now()
  returning id into v_id;
  return v_id;
end; $$;


ALTER FUNCTION "public"."admin_set_coach_package"("p_coach_id" "uuid", "p_package_key" "text", "p_custom_qty" integer, "p_notes" "text", "p_billing_interval" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_paid_coach_package_period_system"("p_provider" "text", "p_provider_event_id" "text", "p_coach_id" "uuid", "p_package_key" "text", "p_client_limit" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_amount_minor" integer DEFAULT NULL::integer, "p_currency" "text" DEFAULT NULL::"text", "p_payment_status" "text" DEFAULT 'paid'::"text", "p_event_type" "text" DEFAULT 'payment_succeeded'::"text", "p_summary" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role     text;
  v_limit    int;
  v_custom   int;
  v_currency text := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_event_id uuid;
begin
  if p_provider is null or p_provider not in ('manual','paymob','stripe') then
    raise exception 'invalid provider: %', coalesce(p_provider, '(null)');
  end if;
  if p_provider_event_id is null or length(p_provider_event_id) = 0 then
    raise exception 'provider_event_id required';
  end if;

  select role into v_role from public.profiles where id = p_coach_id;
  if v_role is null or v_role not in ('coach','admin') then
    raise exception 'target must be an existing coach or admin';
  end if;

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

  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'p_period_end must be after p_period_start';
  end if;

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
$$;


ALTER FUNCTION "public"."apply_paid_coach_package_period_system"("p_provider" "text", "p_provider_event_id" "text", "p_coach_id" "uuid", "p_package_key" "text", "p_client_limit" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_amount_minor" integer, "p_currency" "text", "p_payment_status" "text", "p_event_type" "text", "p_summary" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_subscription_expiry"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$begin
  update public.subscriptions
  set status = 'expired', updated_at = now()
  where status = 'active'
    and end_date < current_date;
end;$$;


ALTER FUNCTION "public"."check_subscription_expiry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."coach_slot_status"("p_coach_id" "uuid" DEFAULT "auth"."uid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_caller uuid := auth.uid(); v_role text; v_pkg text; v_limit int; v_status text; v_used int; v_interval text;
begin
  if not ( public.is_admin() or p_coach_id = v_caller ) then raise exception 'permission denied'; end if;
  select role into v_role from profiles where id = p_coach_id;
  if v_role is null then raise exception 'no such profile'; end if;
  select count(*) into v_used from profiles p where p.assigned_coach = p_coach_id and p.role = 'client';
  if v_role = 'admin' then
    return jsonb_build_object('coach_id', p_coach_id, 'package_key','admin','client_limit',null,
      'used',v_used,'remaining',null,'status','active','unlimited',true,'billing_interval','monthly');
  end if;
  select package_key, client_limit, status, billing_interval into v_pkg, v_limit, v_status, v_interval
    from coach_subscriptions where coach_id = p_coach_id;
  if v_pkg is null then v_pkg := 'free'; v_limit := 1; v_status := 'active'; end if;
  return jsonb_build_object('coach_id', p_coach_id, 'package_key', v_pkg, 'client_limit', v_limit, 'used', v_used,
    'remaining', case when v_limit is null then null else greatest(0, v_limit - v_used) end,
    'status', v_status, 'unlimited', (v_limit is null), 'billing_interval', coalesce(v_interval, 'monthly'));
end; $$;


ALTER FUNCTION "public"."coach_slot_status"("p_coach_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_onboarding"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update profiles set onboarding_completed_at = now()
   where id = auth.uid() and onboarding_completed_at is null;
end; $$;


ALTER FUNCTION "public"."complete_onboarding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_client_subscription"("p_client_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date" DEFAULT NULL::"date", "p_status" "text" DEFAULT 'active'::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_start  date := COALESCE(p_start, current_date);
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), 'active');
  v_end    date;
  v_id     uuid;
BEGIN
  IF NOT (public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_client_id AND p.assigned_coach = v_actor)) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;
  IF p_client_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_client_id AND p.role = 'client') THEN
    RAISE EXCEPTION 'target is not a client account';
  END IF;
  IF p_months IS NULL OR p_months < 1 OR p_months > 60 THEN
    RAISE EXCEPTION 'months must be between 1 and 60'; END IF;
  IF v_status NOT IN ('active', 'pending') THEN
    RAISE EXCEPTION 'new subscription status must be active or pending'; END IF;
  v_end := COALESCE(p_end, (v_start + make_interval(months => p_months))::date);
  IF v_end <= v_start THEN RAISE EXCEPTION 'end date must be after the start date'; END IF;
  IF p_plan_name IS NOT NULL AND char_length(btrim(p_plan_name)) > 80 THEN
    RAISE EXCEPTION 'plan name must be 80 characters or fewer'; END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'notes must be 2000 characters or fewer'; END IF;

  INSERT INTO public.subscriptions
    (client_id, plan_name, plan, start_date, end_date, status, notes, created_by)
  VALUES
    (p_client_id, NULLIF(btrim(p_plan_name), ''), p_months, v_start, v_end,
     v_status, NULLIF(btrim(p_notes), ''), v_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;


ALTER FUNCTION "public"."create_client_subscription"("p_client_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_profile_protected_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Admins and trusted backend (service role, no JWT) may change anything.
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'profiles.role may only be changed by an admin';
  END IF;

  IF NEW.assigned_coach IS DISTINCT FROM OLD.assigned_coach THEN
    RAISE EXCEPTION 'profiles.assigned_coach may only be changed by an admin';
  END IF;

  IF NEW.current_phase IS DISTINCT FROM OLD.current_phase
     AND current_setting('neucore.allow_phase_change', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'profiles.current_phase may only be changed via set_client_phase()';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_profile_protected_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_subscription_notifications"("p_client_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_state record; v_coach uuid; v_window text;
BEGIN
  SELECT * INTO v_state FROM v_client_subscription_state WHERE client_id = p_client_id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT assigned_coach INTO v_coach FROM profiles WHERE id = p_client_id;
  v_window := COALESCE(v_state.sub_id::text, 'none');

  IF v_state.effective_status='active' AND v_state.days_remaining BETWEEN 0 AND 7 THEN
    IF NOT EXISTS (SELECT 1 FROM notifications
      WHERE recipient_id=p_client_id AND type='subscription_expiring' AND data->>'window'=v_window) THEN
      PERFORM public.notify(
        p_recipient_id => p_client_id, p_type => 'subscription_expiring',
        p_title => 'Subscription ending in ' || v_state.days_remaining || ' day(s)',
        p_body => 'Contact your coach to renew before access becomes read-only.',
        p_link_section => 'dashboard', p_link_params => '{}'::jsonb, p_severity => 'warning',
        p_data => jsonb_build_object('window', v_window, 'days_remaining', v_state.days_remaining),
        p_actor_id => p_client_id);
    END IF;
    IF v_coach IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notifications
      WHERE recipient_id=v_coach AND type='subscription_expiring'
        AND data->>'window'=v_window AND data->>'client_id'=p_client_id::text) THEN
      PERFORM public.notify(
        p_recipient_id => v_coach, p_type => 'subscription_expiring',
        p_title => 'A client''s subscription ends soon',
        p_body => 'Ending in ' || v_state.days_remaining || ' day(s) — consider reaching out.',
        p_link_section => 'subscriptions', p_link_params => jsonb_build_object('client_id', p_client_id),
        p_severity => 'info',
        p_data => jsonb_build_object('window', v_window, 'client_id', p_client_id),
        p_actor_id => p_client_id);
    END IF;
  END IF;

  IF v_state.effective_status='grace' THEN
    IF NOT EXISTS (SELECT 1 FROM notifications
      WHERE recipient_id=p_client_id AND type='subscription_grace' AND data->>'window'=v_window) THEN
      PERFORM public.notify(
        p_recipient_id => p_client_id, p_type => 'subscription_grace',
        p_title => 'You''re in your grace period',
        p_body => v_state.grace_days_left || ' day(s) left to renew before access ends.',
        p_link_section => 'dashboard', p_link_params => '{}'::jsonb, p_severity => 'critical',
        p_data => jsonb_build_object('window', v_window, 'grace_days_left', v_state.grace_days_left),
        p_actor_id => p_client_id);
    END IF;
    IF v_coach IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notifications
      WHERE recipient_id=v_coach AND type='subscription_grace'
        AND data->>'window'=v_window AND data->>'client_id'=p_client_id::text) THEN
      PERFORM public.notify(
        p_recipient_id => v_coach, p_type => 'subscription_grace',
        p_title => 'Client is in grace',
        p_body => v_state.grace_days_left || ' day(s) before they lose access.',
        p_link_section => 'subscriptions', p_link_params => jsonb_build_object('client_id', p_client_id),
        p_severity => 'warning',
        p_data => jsonb_build_object('window', v_window, 'client_id', p_client_id),
        p_actor_id => p_client_id);
    END IF;
  END IF;
END; $$;


ALTER FUNCTION "public"."ensure_subscription_notifications"("p_client_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_my_stale_workout_sessions"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid   uuid := (select auth.uid());
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  with expired as (
    update public.workout_sessions s
       set status           = 'abandoned',
           ended_at         = least(now(), s.started_at + interval '2 hours'),
           duration_seconds = extract(epoch from (least(now(), s.started_at + interval '2 hours') - s.started_at))::int,
           end_reason       = 'auto_finished_2h'
     where s.status = 'active'
       and s.ended_at is null
       and s.started_at < now() - interval '2 hours'
       and (
            s.client_id = v_uid
         or public.is_admin()
         or s.coach_id = v_uid
         or exists (
              select 1 from public.profiles p
              where p.id = s.client_id and p.assigned_coach = v_uid
            )
       )
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."expire_my_stale_workout_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_workout_sessions_all"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_count int;
begin
  with expired as (
    update public.workout_sessions s
       set status           = 'abandoned',
           ended_at         = least(now(), s.started_at + interval '2 hours'),
           duration_seconds = extract(epoch from (least(now(), s.started_at + interval '2 hours') - s.started_at))::int,
           end_reason       = 'auto_finished_2h'
     where s.status = 'active'
       and s.ended_at is null
       and s.started_at < now() - interval '2 hours'
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."expire_stale_workout_sessions_all"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_pulse_for_alerts"() RETURNS TABLE("client_id" "uuid", "pulse_status" "text", "severity" integer, "reasons" "text"[], "churn_risk" boolean, "effective_status" "text", "days_since_activity" integer, "adherence_7d" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_admin uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_admin is null then
    return;
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );
  return query
    select v.client_id, v.pulse_status, v.severity::int, v.reasons,
           v.churn_risk, v.effective_status, v.days_since_activity, v.adherence_7d
    from public.v_client_pulse v;
end;
$$;


ALTER FUNCTION "public"."fn_pulse_for_alerts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'client'   -- SECURITY: ignore any client-supplied role; elevation only via create-user
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_accepted_current_legal"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when p_user_id is null then false
    when (select auth.uid()) is null then false
    when p_user_id <> (select auth.uid()) and not public.is_admin() then false
    else not exists (
      -- a required+current doc for which the user has NO matching-version acceptance
      select 1
      from public.legal_documents d
      where d.is_current = true
        and d.is_required = true
        and not exists (
          select 1
          from public.legal_acceptances a
          where a.user_id = p_user_id
            and (case d.doc_type
                   when 'terms'                then a.terms_version
                   when 'privacy'              then a.privacy_version
                   when 'medical_disclaimer'   then a.medical_disclaimer_version
                   when 'health_data_consent'  then a.health_data_consent_version
                   when 'refund'               then a.refund_policy_version
                   when 'cookie'               then a.cookie_policy_version
                 end) = d.version
        )
    )
  end;
$$;


ALTER FUNCTION "public"."has_accepted_current_legal"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_or_coach"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role in ('admin','coach') from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."is_admin_or_coach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_coach"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'coach'
  );
$$;


ALTER FUNCTION "public"."is_coach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_coach_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('coach','admin')
  );
$$;


ALTER FUNCTION "public"."is_coach_or_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text" DEFAULT NULL::"text", "p_link_section" "text" DEFAULT NULL::"text", "p_link_params" "jsonb" DEFAULT '{}'::"jsonb", "p_severity" "text" DEFAULT 'info'::"text", "p_data" "jsonb" DEFAULT '{}'::"jsonb", "p_actor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_actor    uuid := COALESCE(p_actor_id, auth.uid());
  v_allowed  boolean := false;
  v_id       uuid;
BEGIN
  IF p_recipient_id IS NULL THEN RAISE EXCEPTION 'recipient_id required'; END IF;
  IF v_actor IS NULL OR v_actor = p_recipient_id THEN v_allowed := true;
  ELSIF public.is_admin() THEN v_allowed := true;
  ELSIF EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_recipient_id AND p.assigned_coach = v_actor) THEN v_allowed := true;
  ELSIF EXISTS (SELECT 1 FROM profiles me WHERE me.id = v_actor AND me.assigned_coach = p_recipient_id) THEN v_allowed := true;
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'notify: actor % not permitted to notify %', v_actor, p_recipient_id;
  END IF;
  INSERT INTO notifications
    (recipient_id, actor_id, type, title, body, link_section, link_params, severity, data)
  VALUES
    (p_recipient_id, v_actor, p_type, p_title, p_body,
     p_link_section, COALESCE(p_link_params,'{}'::jsonb),
     COALESCE(p_severity,'info'), COALESCE(p_data,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."notify"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link_section" "text", "p_link_params" "jsonb", "p_severity" "text", "p_data" "jsonb", "p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ops_health_snapshot"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_jobs    jsonb;
  v_edge    jsonb;
  v_overall boolean;
begin
  -- Owner/admin only (single-admin model). No cross-user information leak.
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Per-expected-job DISPATCH health (from cron.* only)
  with expected(jobname, expected_interval_min) as (
    values
      ('subscription-checker-daily',   1440),
      ('pulse-alerts-daily',           1440),
      ('expire-stale-workouts-hourly',   60)
  ),
  jobrow as (
    select
      e.jobname,
      e.expected_interval_min,
      j.jobid,
      (j.jobid is not null)     as present,
      coalesce(j.active, false) as active,
      j.schedule,
      lr.last_run_at,
      lr.last_run_status
    from expected e
    left join cron.job j on j.jobname = e.jobname
    left join lateral (
      select coalesce(d.end_time, d.start_time) as last_run_at,
             d.status                           as last_run_status
      from cron.job_run_details d
      where d.jobid = j.jobid
      order by coalesce(d.end_time, d.start_time) desc nulls last
      limit 1
    ) lr on true
  ),
  calc as (
    select
      jobname, expected_interval_min, present, active, schedule,
      last_run_at, last_run_status,
      case when last_run_at is null then null
           else floor(extract(epoch from (now() - last_run_at)) / 60)::int
      end as minutes_since_last,
      case
        when last_run_at is null then true
        when extract(epoch from (now() - last_run_at)) / 60
             > (expected_interval_min * 1.5 + 15) then true
        else false
      end as stale
    from jobrow
  )
  select jsonb_agg(
           jsonb_build_object(
             'jobname',               jobname,
             'present',               present,
             'active',                active,
             'schedule',              schedule,
             'expected_interval_min', expected_interval_min,
             'last_run_at',           last_run_at,
             'last_run_status',       last_run_status,
             'minutes_since_last',    minutes_since_last,
             'stale',                 stale,
             'healthy',               (present and active and not stale
                                       and last_run_status = 'succeeded'),
             'reason',
               case
                 when not present then 'job missing from cron.job'
                 when not active  then 'job inactive'
                 when last_run_at is null then 'no run recorded'
                 when stale then 'stale: no dispatch within expected window'
                 when last_run_status is distinct from 'succeeded'
                   then 'last dispatch status: ' || coalesce(last_run_status, 'unknown')
                 else 'ok'
               end
           )
           order by jobname
         )
    into v_jobs
    from calc;

  -- GLOBAL edge-HTTP summary (best-effort; SAFE columns only).
  -- Reads ONLY status_code / created / timed_out from net._http_response.
  -- NEVER touches net.http_request_queue (secret headers) and NEVER returns
  -- response headers / content / error_msg.
  begin
    select jsonb_build_object(
             'available', true,
             'last_status',
               (select r.status_code from net._http_response r
                 order by r.created desc nulls last limit 1),
             'last_at',
               (select r.created from net._http_response r
                 order by r.created desc nulls last limit 1),
             'non_2xx_last_24h',
               (select count(*) from net._http_response r
                 where r.created > now() - interval '24 hours'
                   and (r.status_code is null or r.status_code < 200 or r.status_code >= 300)),
             'timed_out_last_24h',
               (select count(*) from net._http_response r
                 where r.created > now() - interval '24 hours'
                   and r.timed_out is true),
             'note', 'Global pg_net responses (cron + app edge calls). '
                     || 'Best-effort, short retention, not attributed per job. '
                     || 'No headers/body/secret exposed.'
           )
      into v_edge;
  exception when others then
    v_edge := jsonb_build_object(
                'available', false,
                'note', 'net._http_response not readable in this context');
  end;

  select bool_and((x ->> 'healthy')::boolean)
    into v_overall
    from jsonb_array_elements(coalesce(v_jobs, '[]'::jsonb)) x;

  return jsonb_build_object(
    'generated_at',    now(),
    'overall_healthy', coalesce(v_overall, false),
    'jobs',            coalesce(v_jobs, '[]'::jsonb),
    'edge_http',       v_edge
  );
end;
$$;


ALTER FUNCTION "public"."ops_health_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ops_health_snapshot_system"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_jobs    jsonb;
  v_edge    jsonb;
  v_overall boolean;
begin
  with expected(jobname, expected_interval_min) as (
    values
      ('subscription-checker-daily',   1440),
      ('pulse-alerts-daily',           1440),
      ('expire-stale-workouts-hourly',   60)
  ),
  jobrow as (
    select
      e.jobname,
      e.expected_interval_min,
      j.jobid,
      (j.jobid is not null)     as present,
      coalesce(j.active, false) as active,
      j.schedule,
      lr.last_run_at,
      lr.last_run_status
    from expected e
    left join cron.job j on j.jobname = e.jobname
    left join lateral (
      select coalesce(d.end_time, d.start_time) as last_run_at,
             d.status                           as last_run_status
      from cron.job_run_details d
      where d.jobid = j.jobid
      order by coalesce(d.end_time, d.start_time) desc nulls last
      limit 1
    ) lr on true
  ),
  calc as (
    select
      jobname, expected_interval_min, present, active, schedule,
      last_run_at, last_run_status,
      case when last_run_at is null then null
           else floor(extract(epoch from (now() - last_run_at)) / 60)::int
      end as minutes_since_last,
      case
        when last_run_at is null then true
        when extract(epoch from (now() - last_run_at)) / 60
             > (expected_interval_min * 1.5 + 15) then true
        else false
      end as stale
    from jobrow
  )
  select jsonb_agg(
           jsonb_build_object(
             'jobname',               jobname,
             'present',               present,
             'active',                active,
             'schedule',              schedule,
             'expected_interval_min', expected_interval_min,
             'last_run_at',           last_run_at,
             'last_run_status',       last_run_status,
             'minutes_since_last',    minutes_since_last,
             'stale',                 stale,
             'healthy',               (present and active and not stale
                                       and last_run_status = 'succeeded'),
             'reason',
               case
                 when not present then 'job missing from cron.job'
                 when not active  then 'job inactive'
                 when last_run_at is null then 'no run recorded'
                 when stale then 'stale: no dispatch within expected window'
                 when last_run_status is distinct from 'succeeded'
                   then 'last dispatch status: ' || coalesce(last_run_status, 'unknown')
                 else 'ok'
               end
           )
           order by jobname
         )
    into v_jobs
    from calc;

  begin
    select jsonb_build_object(
             'available', true,
             'last_status',
               (select r.status_code from net._http_response r
                 order by r.created desc nulls last limit 1),
             'last_at',
               (select r.created from net._http_response r
                 order by r.created desc nulls last limit 1),
             'non_2xx_last_24h',
               (select count(*) from net._http_response r
                 where r.created > now() - interval '24 hours'
                   and (r.status_code is null or r.status_code < 200 or r.status_code >= 300)),
             'timed_out_last_24h',
               (select count(*) from net._http_response r
                 where r.created > now() - interval '24 hours'
                   and r.timed_out is true),
             'note', 'Global pg_net responses (cron + app edge calls). '
                     || 'Best-effort, short retention, not attributed per job. '
                     || 'No headers/body/secret exposed.'
           )
      into v_edge;
  exception when others then
    v_edge := jsonb_build_object(
                'available', false,
                'note', 'net._http_response not readable in this context');
  end;

  select bool_and((x ->> 'healthy')::boolean)
    into v_overall
    from jsonb_array_elements(coalesce(v_jobs, '[]'::jsonb)) x;

  return jsonb_build_object(
    'generated_at',    now(),
    'overall_healthy', coalesce(v_overall, false),
    'jobs',            coalesce(v_jobs, '[]'::jsonb),
    'edge_http',       v_edge
  );
end;
$$;


ALTER FUNCTION "public"."ops_health_snapshot_system"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_program_version"("p_version_id" "uuid", "p_change_note" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_ver     public.client_program_versions%rowtype;
  v_uid     uuid := (select auth.uid());
  v_allowed boolean;
  v_cp_id   uuid;
  v_new_rev int;
  v_note    text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_ver
    from public.client_program_versions
   where id = p_version_id
   for update;
  if not found then
    raise exception 'program version % not found', p_version_id using errcode = 'P0002';
  end if;

  v_allowed := public.is_admin()
    or v_ver.coach_id = v_uid
    or exists (
      select 1 from public.profiles p
      where p.id = v_ver.client_id and p.assigned_coach = v_uid
    );
  if not v_allowed then
    raise exception 'not authorized to publish this version' using errcode = '42501';
  end if;

  v_note := coalesce(p_change_note, v_ver.change_note);

  -- (a) Supersede any OTHER active version for this client (keep the target).
  update public.client_program_versions
     set status = 'superseded', updated_at = now()
   where client_id = v_ver.client_id
     and status = 'active'
     and id <> v_ver.id;

  -- (b) Activate + publish the target version, effective now.
  update public.client_program_versions
     set status = 'active', published = true,
         effective_from = now(), published_at = now(),
         change_note = v_note, updated_at = now()
   where id = v_ver.id;

  -- (c) Update the single client-visible pointer.
  insert into public.client_programs
    (client_id, coach_id, program, published, published_at, revision, change_note, changed_by, updated_at)
  values
    (v_ver.client_id, v_ver.coach_id, v_ver.program, true, now(), 1, v_note, v_uid, now())
  on conflict (client_id) do update
    set program      = excluded.program,
        coach_id     = coalesce(client_programs.coach_id, excluded.coach_id),
        published    = true,
        published_at = now(),
        revision     = client_programs.revision + 1,
        change_note  = excluded.change_note,
        changed_by   = v_uid,
        updated_at   = now()
  returning id, revision into v_cp_id, v_new_rev;

  -- (d) Snapshot the revision into the audit trail.
  insert into public.client_program_revisions
    (program_id, client_id, coach_id, revision, program, program_mode, change_note, changed_by)
  select v_cp_id, v_ver.client_id, cp.coach_id, v_new_rev, v_ver.program, cp.program_mode, v_note, v_uid
    from public.client_programs cp
   where cp.id = v_cp_id;

  -- Link the published version back to the pointer for history/joins.
  update public.client_program_versions
     set source_program_id = v_cp_id, source_revision = v_new_rev
   where id = v_ver.id;

  return v_ver.id;
end;
$$;


ALTER FUNCTION "public"."publish_program_version"("p_version_id" "uuid", "p_change_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reactivate_subscription"("p_client_id" "uuid", "p_months" integer, "p_start" "date" DEFAULT NULL::"date", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_start date := COALESCE(p_start, current_date);
  v_end   date := (v_start + (p_months || ' months')::interval)::date;
  v_id    uuid;
BEGIN
  IF NOT (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = p_client_id AND p.assigned_coach = v_actor
    )
  ) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;

  INSERT INTO subscriptions
    (client_id, plan, start_date, end_date, status, notes, created_by)
  VALUES
    (p_client_id, p_months, v_start, v_end, 'active', p_notes, v_actor)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."reactivate_subscription"("p_client_id" "uuid", "p_months" integer, "p_start" "date", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_legal_acceptance"("p_versions" "jsonb", "p_source" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_uid     uuid := (select auth.uid());
  v_role    text;
  v_missing text;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- 'admin_seed' is reserved for out-of-band seeding, never a real user acceptance.
  if p_source is null
     or p_source not in ('signup','first_login_gate','reaccept_version_change') then
    raise exception 'invalid acceptance_source: %', coalesce(p_source, '(null)')
      using errcode = '22023';
  end if;

  if p_versions is null or jsonb_typeof(p_versions) <> 'object' then
    raise exception 'p_versions must be a json object' using errcode = '22023';
  end if;

  -- Stamp the role from the DB, not from anything the client supplied.
  select role into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'no profile for user' using errcode = 'P0002';
  end if;

  -- Every required+current document must be present with its CURRENT version.
  select string_agg(d.doc_type, ', ' order by d.doc_type) into v_missing
  from public.legal_documents d
  where d.is_current = true
    and d.is_required = true
    and coalesce(p_versions ->> d.doc_type, '') <> d.version;
  if v_missing is not null then
    raise exception 'submitted versions do not match current required legal documents: %', v_missing
      using errcode = '22023';
  end if;

  insert into public.legal_acceptances (
    user_id, acceptance_source, role_at_acceptance,
    terms_version, privacy_version, medical_disclaimer_version,
    health_data_consent_version, refund_policy_version, cookie_policy_version
  )
  values (
    v_uid, p_source, v_role,
    p_versions ->> 'terms',
    p_versions ->> 'privacy',
    p_versions ->> 'medical_disclaimer',
    p_versions ->> 'health_data_consent',
    p_versions ->> 'refund',
    p_versions ->> 'cookie'
  )
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."record_legal_acceptance"("p_versions" "jsonb", "p_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rpm_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."rpm_touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'client'::"text" NOT NULL,
    "current_phase" "text" DEFAULT 'Phase 1'::"text",
    "age" integer,
    "phone" "text",
    "goal" "text",
    "injury_history" "text",
    "assigned_coach" "uuid",
    "coach_name" "text",
    "avatar_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "onboarding_completed_at" timestamp with time zone,
    "calendly_url" "text",
    "country" "text",
    "business_name" "text",
    "professional_title" "text",
    CONSTRAINT "profiles_calendly_url_chk" CHECK ((("calendly_url" IS NULL) OR ("calendly_url" ~* '^https?://'::"text"))),
    CONSTRAINT "profiles_current_phase_check" CHECK (("current_phase" = ANY (ARRAY['Phase 1'::"text", 'Phase 2'::"text", 'Phase 3'::"text"]))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'coach'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."onboarding_completed_at" IS 'When the coach finished or skipped the first-login tour. NULL = show the tour. Backfilled to now() for pre-Phase-4 coaches/admins. New self-signup coaches start NULL.';



CREATE OR REPLACE FUNCTION "public"."set_client_phase"("p_client_id" "uuid", "p_new_phase" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    text;
  v_old     text;
  v_cur_ord int;
  v_new_ord int;
  v_row     public.profiles;
BEGIN
  SELECT role, current_phase INTO v_role, v_old FROM profiles WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found';
  END IF;
  IF v_role IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'target is not a client';
  END IF;

  IF NOT (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = p_client_id AND p.assigned_coach = v_actor)
  ) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;

  IF p_new_phase IS NULL OR p_new_phase !~ '^Phase [1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid phase: %', p_new_phase;
  END IF;

  v_cur_ord := COALESCE(NULLIF(regexp_replace(COALESCE(v_old, ''), '\D', '', 'g'), '')::int, 0);
  v_new_ord := regexp_replace(p_new_phase, '\D', '', 'g')::int;

  IF v_new_ord = v_cur_ord THEN
    RAISE EXCEPTION 'client is already on %', COALESCE(v_old, 'that phase');
  END IF;
  IF v_new_ord < v_cur_ord THEN
    RAISE EXCEPTION 'downgrade not supported (% -> %)', v_old, p_new_phase;
  END IF;

  PERFORM set_config('neucore.allow_phase_change', 'on', true);
  UPDATE profiles SET current_phase = p_new_phase WHERE id = p_client_id
    RETURNING * INTO v_row;
  PERFORM set_config('neucore.allow_phase_change', 'off', true);

  RETURN v_row;
END;
$_$;


ALTER FUNCTION "public"."set_client_phase"("p_client_id" "uuid", "p_new_phase" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_aer_notify_client"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sub_name text;
  v_body     text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('addressed','declined') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;

  IF NEW.status = 'addressed' AND NEW.substitute_exercise_id IS NOT NULL THEN
    SELECT name INTO v_sub_name FROM exercises WHERE id = NEW.substitute_exercise_id;
    v_body := 'Your coach replaced ' || NEW.exercise_name
              || ' with ' || COALESCE(v_sub_name, 'a new exercise')
              || CASE WHEN NEW.coach_response IS NOT NULL
                       AND length(NEW.coach_response) > 0
                      THEN ' — ' || NEW.coach_response
                      ELSE '.' END;
  ELSE
    v_body := COALESCE(NEW.coach_response, 'See details for next steps.');
  END IF;

  PERFORM public.notify(
    p_recipient_id => NEW.client_id,
    p_type         => 'alt_exercise_decided',
    p_title        => CASE WHEN NEW.status = 'addressed'
                           THEN 'Your alternative exercise was addressed'
                           ELSE 'Your alternative request was declined' END,
    p_body         => v_body,
    p_link_section => 'my-program',
    p_link_params  => jsonb_build_object(
                        'request_id',             NEW.id,
                        'substitute_exercise_id', NEW.substitute_exercise_id),
    p_severity     => CASE WHEN NEW.status = 'addressed' THEN 'info' ELSE 'warning' END,
    p_data         => jsonb_build_object(
                        'request_id',             NEW.id,
                        'status',                 NEW.status,
                        'substitute_exercise_id', NEW.substitute_exercise_id),
    p_actor_id     => NEW.coach_id
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tg_aer_notify_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_aer_notify_coach"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_client_name text;
BEGIN
  IF NOT public._profile_exists(NEW.coach_id) THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO v_client_name FROM profiles WHERE id = NEW.client_id;
  PERFORM public.notify(
    p_recipient_id => NEW.coach_id, p_type => 'alt_exercise_request',
    p_title => 'Alternative exercise requested',
    p_body => COALESCE(v_client_name,'A client') || ' is asking about: ' || NEW.exercise_name,
    p_link_section => 'notifications',
    p_link_params => jsonb_build_object('request_id', NEW.id, 'client_id', NEW.client_id),
    p_severity => 'warning',
    p_data => jsonb_build_object('request_id', NEW.id, 'workout_key', NEW.workout_key,
                                  'exercise_name', NEW.exercise_name, 'reason', NEW.reason),
    p_actor_id => NEW.client_id);
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."tg_aer_notify_coach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_appt_notify_client"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_type_label text := case new.type
                         when 'assessment'     then 'Assessment'
                         when 'check_in'       then 'Check-in'
                         when 'follow_up'      then 'Follow-up'
                         when 'program_review' then 'Program review'
                         else 'session' end;
  v_when text := to_char(new.starts_at, 'FMDay FMDD Mon at FMHH12:MI AM');
  v_title text;
  v_body  text;
  v_ntype text;
  v_sev   text := 'info';
begin
  if tg_op = 'INSERT' then
    v_ntype := 'appointment_scheduled';
    v_title := 'New ' || v_type_label || ' session scheduled';
    v_body  := 'Your coach scheduled a ' || lower(v_type_label) || ' session for ' || v_when || '.';
  elsif tg_op = 'UPDATE' then
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      v_ntype := 'appointment_cancelled';
      v_sev   := 'warning';
      v_title := v_type_label || ' session cancelled';
      v_body  := 'Your ' || lower(v_type_label) || ' session for ' || v_when || ' has been cancelled.'
                 || case when new.cancellation_reason is not null and length(trim(new.cancellation_reason)) > 0
                         then ' ' || new.cancellation_reason else '' end;
    elsif new.status = 'scheduled'
          and (new.starts_at is distinct from old.starts_at
               or new.meeting_url is distinct from old.meeting_url) then
      v_ntype := 'appointment_updated';
      v_title := v_type_label || ' session updated';
      v_body  := 'Your ' || lower(v_type_label) || ' session has been updated — now ' || v_when || '.';
    else
      return null;
    end if;
  else
    return null;
  end if;

  if new.meeting_url is not null and new.status = 'scheduled' then
    v_body := v_body || ' Join link: ' || new.meeting_url;
  end if;

  perform public.notify(
    p_recipient_id => new.client_id,
    p_type         => v_ntype,
    p_title        => v_title,
    p_body         => v_body,
    p_link_section => 'client-coach',
    p_link_params  => jsonb_build_object('appointment_id', new.id),
    p_severity     => v_sev,
    p_data         => jsonb_build_object('appointment_id', new.id, 'type', new.type, 'status', new.status),
    p_actor_id     => new.coach_id
  );
  return null;
end;
$$;


ALTER FUNCTION "public"."tg_appt_notify_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_appt_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_appt_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_athletic_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_athletic_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_case_share_notify_admins"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_admin record; v_coach_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO v_coach_name FROM profiles WHERE id = NEW.coach_id;
  FOR v_admin IN SELECT id FROM profiles WHERE role='admin' LOOP
    PERFORM public.notify(
      p_recipient_id => v_admin.id, p_type => 'case_approval_pending',
      p_title => 'Case study awaiting approval',
      p_body => COALESCE(v_coach_name,'A coach') || ' submitted: ' || NEW.title,
      p_link_section => 'rpm-approvals',
      p_link_params => jsonb_build_object('case_id', NEW.id),
      p_severity => 'info',
      p_data => jsonb_build_object('case_id', NEW.id),
      p_actor_id => NEW.coach_id);
  END LOOP;
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."tg_case_share_notify_admins"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_case_share_notify_coach"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.coach_id) THEN RETURN NEW; END IF;
  PERFORM public.notify(
    p_recipient_id => NEW.coach_id, p_type => 'case_approval_decided',
    p_title => CASE NEW.status WHEN 'approved' THEN 'Case study approved' ELSE 'Case study rejected' END,
    p_body => NEW.review_note,
    p_link_section => 'case-studies',
    p_link_params => jsonb_build_object('case_id', NEW.id),
    p_severity => CASE NEW.status WHEN 'approved' THEN 'info' ELSE 'warning' END,
    p_data => jsonb_build_object('case_id', NEW.id, 'status', NEW.status),
    p_actor_id => NEW.reviewed_by);
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."tg_case_share_notify_coach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_cp_revision_set"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.revision   := 1;
    new.changed_by := coalesce(auth.uid(), new.changed_by, new.coach_id);
    new.updated_at := now();
  elsif new.program      is distinct from old.program
        or new.program_mode is distinct from old.program_mode
        or new.change_note  is distinct from old.change_note then
    new.revision   := coalesce(old.revision, 0) + 1;
    new.changed_by := coalesce(auth.uid(), new.changed_by, new.coach_id);
    new.updated_at := now();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_cp_revision_set"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_cp_revision_snap"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'UPDATE'
     and new.program      is not distinct from old.program
     and new.program_mode is not distinct from old.program_mode
     and new.change_note  is not distinct from old.change_note then
    return null;   -- no material change → no new revision
  end if;
  insert into public.client_program_revisions
    (program_id, client_id, coach_id, revision, program, program_mode, change_note, changed_by)
    values (new.id, new.client_id, new.coach_id, new.revision, new.program,
            new.program_mode, new.change_note, new.changed_by);
  return null;
end;
$$;


ALTER FUNCTION "public"."tg_cp_revision_snap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_cpv_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_cpv_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_legal_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."tg_legal_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_phase_subm_notify_client"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_coach uuid;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected','modified') THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(NEW.client_id) THEN RETURN NEW; END IF;
  SELECT coach_id INTO v_coach FROM rpm_graphs WHERE id = NEW.graph_id;
  PERFORM public.notify(
    p_recipient_id => NEW.client_id, p_type => 'rpm_approval_decided',
    p_title => CASE NEW.status
                  WHEN 'approved' THEN 'Phase approved — you can advance'
                  WHEN 'modified' THEN 'Phase needs modification'
                  ELSE 'Phase rejected — see notes' END,
    p_body => NEW.coach_note,
    p_link_section => 'my-graph',
    p_link_params => jsonb_build_object('submission_id', NEW.id, 'graph_id', NEW.graph_id),
    p_severity => CASE NEW.status WHEN 'approved' THEN 'info' ELSE 'warning' END,
    p_data => jsonb_build_object('submission_id', NEW.id, 'status', NEW.status),
    p_actor_id => v_coach);
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."tg_phase_subm_notify_client"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_phase_subm_notify_coach"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_coach uuid; v_client_name text;
BEGIN
  SELECT coach_id INTO v_coach FROM rpm_graphs WHERE id = NEW.graph_id;
  IF v_coach IS NULL THEN RETURN NEW; END IF;
  IF NOT public._profile_exists(v_coach) THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO v_client_name FROM profiles WHERE id = NEW.client_id;
  PERFORM public.notify(
    p_recipient_id => v_coach, p_type => 'rpm_approval_pending',
    p_title => 'Phase submission awaiting review',
    p_body => COALESCE(v_client_name,'A client') || ' submitted a phase for your approval.',
    p_link_section => 'rpm-approvals',
    p_link_params => jsonb_build_object('submission_id', NEW.id, 'client_id', NEW.client_id),
    p_severity => 'warning',
    p_data => jsonb_build_object('submission_id', NEW.id, 'graph_id', NEW.graph_id),
    p_actor_id => NEW.client_id);
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."tg_phase_subm_notify_coach"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_profile_phase_upgrade"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.current_phase IS NULL OR NEW.current_phase = OLD.current_phase THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM 'client' THEN RETURN NEW; END IF;
  PERFORM public.notify(
    p_recipient_id => NEW.id, p_type => 'phase_upgrade',
    p_title => '🏆 Phase upgrade — ' || NEW.current_phase,
    p_body  => 'Your coach advanced you to ' || NEW.current_phase
               || '. Open your dashboard to see what changes.',
    p_link_section => 'dashboard',
    p_link_params  => jsonb_build_object('new_phase', NEW.current_phase),
    p_severity => 'info',
    p_data => jsonb_build_object('from_phase', OLD.current_phase, 'to_phase', NEW.current_phase),
    p_actor_id => COALESCE(auth.uid(), NEW.id));
  RETURN NEW;
END; $$;


ALTER FUNCTION "public"."tg_profile_phase_upgrade"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_coach_subscriptions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin new.updated_at = now(); return new; end;
$$;


ALTER FUNCTION "public"."touch_coach_subscriptions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_workout_log_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."touch_workout_log_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_client_subscription"("p_subscription_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text" DEFAULT NULL::"text", "p_grace_days" integer DEFAULT NULL::integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_actor uuid := auth.uid(); v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.subscriptions WHERE id = p_subscription_id;
  IF v_client IS NULL THEN RAISE EXCEPTION 'subscription not found'; END IF;
  IF NOT (public.is_admin()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = v_client AND p.assigned_coach = v_actor)) THEN
    RAISE EXCEPTION 'permission denied: not the assigned coach or admin';
  END IF;
  IF p_months IS NULL OR p_months < 1 OR p_months > 60 THEN
    RAISE EXCEPTION 'months must be between 1 and 60'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'pending', 'expired') THEN
    RAISE EXCEPTION 'status must be active, pending, or expired'; END IF;
  IF p_status = 'expired' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin may expire a subscription'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RAISE EXCEPTION 'end date must be after the start date'; END IF;
  IF p_grace_days IS NOT NULL AND (p_grace_days < 0 OR p_grace_days > 60) THEN
    RAISE EXCEPTION 'grace days must be between 0 and 60'; END IF;
  IF p_plan_name IS NOT NULL AND char_length(btrim(p_plan_name)) > 80 THEN
    RAISE EXCEPTION 'plan name must be 80 characters or fewer'; END IF;
  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'notes must be 2000 characters or fewer'; END IF;

  UPDATE public.subscriptions SET
    plan_name=NULLIF(btrim(p_plan_name),''), plan=p_months, start_date=p_start, end_date=p_end,
    status=p_status, notes=NULLIF(btrim(p_notes),''), grace_days=COALESCE(p_grace_days,grace_days)
  WHERE id = p_subscription_id;
  RETURN p_subscription_id;
END; $$;


ALTER FUNCTION "public"."update_client_subscription"("p_subscription_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text", "p_grace_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_cron_secret"("p_secret" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
      AND decrypted_secret = p_secret
  );
$$;


ALTER FUNCTION "public"."verify_cron_secret"("p_secret" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_ops_health_secret"("p_secret" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case
    when p_secret is null or length(p_secret) = 0 then false
    else exists (
      select 1 from vault.decrypted_secrets
      where name = 'ops_health_secret'
        and decrypted_secret = p_secret
    )
  end;
$$;


ALTER FUNCTION "public"."verify_ops_health_secret"("p_secret" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_feedback_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "graph_id" "uuid",
    "suggestion_kind" "text",
    "original_text" "text",
    "modified_text" "text",
    "reason_category" "text",
    "reason_text" "text",
    "context_jsonb" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_feedback_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "title" "text",
    "type" "text" DEFAULT 'check_in'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "meeting_url" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    CONSTRAINT "appointments_meeting_url_check" CHECK ((("meeting_url" IS NULL) OR ("meeting_url" ~* '^https?://'::"text"))),
    CONSTRAINT "appointments_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "appointments_type_check" CHECK (("type" = ANY (ARRAY['assessment'::"text", 'check_in'::"text", 'follow_up'::"text", 'program_review'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessment_batteries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "name" "text" NOT NULL,
    "sport" "text",
    "position" "text",
    "level" "text",
    "test_order" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."assessment_batteries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "department_id" "uuid",
    "session_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "chief_complaint" "text",
    "pain_location" "text",
    "pain_behaviour" "text",
    "onset" "text",
    "aggravating_factors" "text"[],
    "easing_factors" "text"[],
    "injury_history" "text",
    "previous_treatments" "text",
    "medications" "text",
    "sleep_quality" "text",
    "stress_level" integer,
    "occupation_demands" "text",
    "goals" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "assessments_stress_level_check" CHECK ((("stress_level" >= 1) AND ("stress_level" <= 10)))
);


ALTER TABLE "public"."assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."athlete_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "battery_id" "uuid",
    "assessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "season_phase" "text",
    "conditions" "jsonb",
    "notes" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "athlete_assessments_season_phase_check" CHECK ((("season_phase" IS NULL) OR ("season_phase" = ANY (ARRAY['off'::"text", 'pre'::"text", 'in'::"text", 'post'::"text", 'unknown'::"text"])))),
    CONSTRAINT "athlete_assessments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'final'::"text"])))
);


ALTER TABLE "public"."athlete_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."athlete_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "sport" "text",
    "position" "text",
    "level" "text",
    "training_age_years" numeric,
    "dominant_side" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "season_phase" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "goals" "jsonb",
    "competition_dates" "jsonb",
    "available_days_per_week" integer,
    "session_duration_minutes" integer,
    "equipment" "jsonb",
    "training_environment" "text",
    "injury_history" "jsonb",
    "current_flags" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "athlete_profiles_dominant_side_check" CHECK (("dominant_side" = ANY (ARRAY['left'::"text", 'right'::"text", 'bilateral'::"text", 'unknown'::"text"]))),
    CONSTRAINT "athlete_profiles_season_phase_check" CHECK (("season_phase" = ANY (ARRAY['off'::"text", 'pre'::"text", 'in'::"text", 'post'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."athlete_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."athlete_test_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "category" "text" NOT NULL,
    "test_key" "text" NOT NULL,
    "raw_value" numeric,
    "text_value" "text",
    "unit" "text",
    "side" "text" DEFAULT 'na'::"text" NOT NULL,
    "trial_n" integer,
    "best_of" integer,
    "protocol_version" "text",
    "conditions" "jsonb",
    "ast9_score" numeric,
    "score_confidence" "text",
    "reference_band" "text",
    "asymmetry_pct" numeric,
    "trend_dir" "text",
    "coach_note" "text",
    "is_retest" boolean DEFAULT false NOT NULL,
    "assessed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "athlete_test_results_score_confidence_check" CHECK ((("score_confidence" IS NULL) OR ("score_confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])))),
    CONSTRAINT "athlete_test_results_side_check" CHECK (("side" = ANY (ARRAY['left'::"text", 'right'::"text", 'bilateral'::"text", 'na'::"text"]))),
    CONSTRAINT "athlete_test_results_trend_dir_check" CHECK ((("trend_dir" IS NULL) OR ("trend_dir" = ANY (ARRAY['up'::"text", 'down'::"text", 'flat'::"text"]))))
);


ALTER TABLE "public"."athlete_test_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."athletic_movement_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "movement_domain" "text" NOT NULL,
    "movement_phase" "text",
    "region" "text" NOT NULL,
    "joint" "text",
    "chain" "text",
    "plane" "text",
    "side" "text" DEFAULT 'na'::"text" NOT NULL,
    "observed_range_value" numeric,
    "range_unit" "text",
    "passive_reference_value" numeric,
    "quality_rating" "text",
    "control_note" "text",
    "symmetry_note" "text",
    "asymmetry_pct" numeric,
    "finding_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "pain_flag" boolean DEFAULT false NOT NULL,
    "confidence" "text",
    "source" "text" DEFAULT 'coach_visual'::"text" NOT NULL,
    "linked_test_result_id" "uuid",
    "coach_note" "text",
    "assessed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "athletic_movement_observations_confidence_check" CHECK ((("confidence" IS NULL) OR ("confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])))),
    CONSTRAINT "athletic_movement_observations_finding_tags_valid" CHECK (("finding_tags" <@ ARRAY['limited_range'::"text", 'range_loss_under_load'::"text", 'poor_control'::"text", 'asymmetry'::"text", 'delayed_braking'::"text", 'early_collapse'::"text", 'insufficient_stiffness'::"text", 'excessive_stiffness'::"text", 'poor_trunk_control'::"text", 'poor_pelvic_control'::"text", 'low_force_projection'::"text", 'low_force_absorption'::"text", 'energy_leak'::"text", 'timing_fault'::"text", 'pain_limited'::"text", 'fatigue_limited'::"text"])),
    CONSTRAINT "athletic_movement_observations_movement_domain_check" CHECK (("movement_domain" = ANY (ARRAY['accel'::"text", 'maxv'::"text", 'jump_takeoff'::"text", 'landing'::"text", 'decel'::"text", 'cod'::"text", 'sl_control'::"text", 'lateral'::"text", 'rotation'::"text", 'dyn_mobility'::"text"]))),
    CONSTRAINT "athletic_movement_observations_plane_check" CHECK ((("plane" IS NULL) OR ("plane" = ANY (ARRAY['sagittal'::"text", 'frontal'::"text", 'transverse'::"text", 'multi'::"text", 'na'::"text"])))),
    CONSTRAINT "athletic_movement_observations_quality_rating_check" CHECK ((("quality_rating" IS NULL) OR ("quality_rating" = ANY (ARRAY['solid'::"text", 'adequate'::"text", 'limited'::"text", 'poor'::"text", 'not_assessed'::"text"])))),
    CONSTRAINT "athletic_movement_observations_side_check" CHECK (("side" = ANY (ARRAY['left'::"text", 'right'::"text", 'bilateral'::"text", 'na'::"text"]))),
    CONSTRAINT "athletic_movement_observations_source_check" CHECK (("source" = ANY (ARRAY['coach_visual'::"text", 'video'::"text", 'wearable'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."athletic_movement_observations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."body_map_states" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "assessment_id" "uuid",
    "joint_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "gait_phase_highlight" "text",
    "animation_state" "text" DEFAULT 'idle'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."body_map_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "anonymized_data" "jsonb" DEFAULT '{}'::"jsonb",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_note" "text",
    CONSTRAINT "case_shares_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."case_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid",
    "author_id" "uuid",
    "author_role" "text" DEFAULT 'client'::"text",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "client_comments_author_role_check" CHECK (("author_role" = ANY (ARRAY['client'::"text", 'coach'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."client_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_group_members" (
    "group_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."client_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "focus_area" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."client_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_likes" (
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."client_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "content" "text" NOT NULL,
    "type" "text" DEFAULT 'progress'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "client_posts_type_check" CHECK (("type" = ANY (ARRAY['progress'::"text", 'question'::"text", 'support'::"text", 'milestone'::"text"])))
);


ALTER TABLE "public"."client_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_program_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid",
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "revision" integer NOT NULL,
    "program" "jsonb" NOT NULL,
    "program_mode" "text",
    "change_note" "text",
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_program_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_program_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "program" "jsonb" NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "published" boolean DEFAULT true NOT NULL,
    "source_program_id" "uuid",
    "source_revision" integer,
    "change_note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "client_program_versions_active_published_chk" CHECK ((("status" <> 'active'::"text") OR ("published" = true))),
    CONSTRAINT "client_program_versions_draft_unpublished_chk" CHECK ((("status" <> 'draft'::"text") OR ("published" = false))),
    CONSTRAINT "client_program_versions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'active'::"text", 'superseded'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."client_program_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."client_program_versions" IS 'Phase E1b — per-client timeline of program versions. Client is served the version with the greatest effective_from <= now() (RLS enforces the server-time date boundary). client_programs remains the live current pointer.';



CREATE TABLE IF NOT EXISTS "public"."client_programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "program" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    "published_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "program_mode" "text" DEFAULT 'one_time'::"text" NOT NULL,
    "revision" integer DEFAULT 1 NOT NULL,
    "change_note" "text",
    "changed_by" "uuid",
    CONSTRAINT "client_programs_mode_chk" CHECK (("program_mode" = ANY (ARRAY['one_time'::"text", 'ongoing_manual'::"text", 'ongoing_auto'::"text"])))
);


ALTER TABLE "public"."client_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_questions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "category" "text",
    "is_public" boolean DEFAULT true,
    "assigned_coach_id" "uuid",
    "status" "text" DEFAULT 'open'::"text",
    "answer" "text",
    "answered_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "answered_at" timestamp with time zone,
    CONSTRAINT "client_questions_category_check" CHECK (("category" = ANY (ARRAY['pain'::"text", 'exercise'::"text", 'nutrition'::"text", 'motivation'::"text", 'equipment'::"text"]))),
    CONSTRAINT "client_questions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'answered'::"text", 'resolved'::"text"])))
);


ALTER TABLE "public"."client_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "from_coach_id" "uuid",
    "to_coach_id" "uuid",
    "client_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "responded_at" timestamp with time zone,
    CONSTRAINT "client_referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."client_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_routines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "tasks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "published" boolean DEFAULT false NOT NULL,
    "published_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_routines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_group_members" (
    "group_id" "uuid" NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coach_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coach_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_id" "uuid",
    "receiver_id" "uuid",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone,
    CONSTRAINT "no_self_message" CHECK (("sender_id" <> "receiver_id"))
);


ALTER TABLE "public"."coach_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_peer_reviews" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "case_description" "text",
    "assessment_summary" "text",
    "program_approach" "text",
    "questions_for_peers" "text",
    "responses" "jsonb" DEFAULT '[]'::"jsonb",
    "is_anonymized" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coach_peer_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_referrals" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "from_coach_id" "uuid" NOT NULL,
    "to_coach_id" "uuid" NOT NULL,
    "from_department_id" "uuid",
    "to_department_id" "uuid",
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "coach_referrals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."coach_referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coach_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "package_key" "text" DEFAULT 'free'::"text" NOT NULL,
    "client_limit" integer,
    "custom_qty" integer,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "billing_interval" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "provider" "text" DEFAULT 'manual'::"text" NOT NULL,
    "provider_customer_id" "text",
    "provider_subscription_id" "text",
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "last_payment_status" "text",
    "billing_currency" "text",
    CONSTRAINT "coach_subscriptions_billing_currency_check" CHECK ((("billing_currency" IS NULL) OR ("billing_currency" ~ '^[A-Z]{3}$'::"text"))),
    CONSTRAINT "coach_subscriptions_billing_interval_chk" CHECK (("billing_interval" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "coach_subscriptions_client_limit_check" CHECK ((("client_limit" IS NULL) OR ("client_limit" >= 1))),
    CONSTRAINT "coach_subscriptions_custom_qty_check" CHECK ((("custom_qty" IS NULL) OR ("custom_qty" >= 60))),
    CONSTRAINT "coach_subscriptions_package_key_check" CHECK (("package_key" = ANY (ARRAY['free'::"text", 'starter'::"text", 'growth'::"text", 'pro'::"text", 'scale'::"text", 'custom'::"text"]))),
    CONSTRAINT "coach_subscriptions_provider_check" CHECK (("provider" = ANY (ARRAY['manual'::"text", 'paymob'::"text", 'stripe'::"text"]))),
    CONSTRAINT "coach_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."coach_subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."coach_subscriptions" IS 'Per-coach package + client-slot cap (NOT client access — that is public.subscriptions). client_limit NULL = unlimited. Writes only via admin_set_coach_package() RPC; no direct write policy exists.';



COMMENT ON COLUMN "public"."coach_subscriptions"."provider" IS 'Billing provider for this coach package: manual (admin-assigned, default) | paymob | stripe. Set by the verified webhook RPC; manual stays the fallback.';



COMMENT ON COLUMN "public"."coach_subscriptions"."current_period_end" IS 'Paid-through timestamp set by the verified payment webhook (P2C+). NULL for manual/admin-assigned packages (no automated period).';



CREATE TABLE IF NOT EXISTS "public"."community_comments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."community_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_likes" (
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."community_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_posts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "image_url" "text",
    "likes_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."community_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_routine_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "log_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "completed" boolean DEFAULT false,
    "battery_pct" integer DEFAULT 50,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."daily_routine_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_admins" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "department_id" "uuid",
    "can_edit_workflow" boolean DEFAULT true,
    "can_manage_coaches" boolean DEFAULT true,
    "can_view_analytics" boolean DEFAULT true,
    "assigned_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."department_admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."departments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "color" "text" DEFAULT '#3DF5C1'::"text" NOT NULL,
    "department_admin_id" "uuid",
    "workflow_config" "jsonb" DEFAULT '{}'::"jsonb",
    "youtube_playlists" "jsonb" DEFAULT '{"phase1": null, "phase2": null, "phase3": null}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."departments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_alternative_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid" NOT NULL,
    "program_id" "uuid",
    "workout_key" "text" NOT NULL,
    "exercise_index" integer NOT NULL,
    "exercise_name" "text" NOT NULL,
    "exercise_id" "uuid",
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "coach_response" "text",
    "responded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "substitute_exercise_id" "uuid",
    CONSTRAINT "exercise_alternative_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'addressed'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."exercise_alternative_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."exercise_alternative_requests"."substitute_exercise_id" IS 'When set, the client''s program view (My Program + Workout Tracker) swaps the original exercise at (workout_key, exercise_index) for this library exercise. NULL = no substitute (free-text response only). ON DELETE SET NULL means deleting a library exercise auto-clears the substitution and the client falls back to the original. Persists until the coach clears it or the program is republished (programPublish.publish closes all active substitutions for the client in one UPDATE).';



CREATE TABLE IF NOT EXISTS "public"."exercise_playlists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "youtube_playlist_id" "text" NOT NULL,
    "name" "text",
    "phase_mapping" "text",
    "auto_sync" boolean DEFAULT false,
    "last_synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "exercise_playlists_phase_mapping_check" CHECK (("phase_mapping" = ANY (ARRAY['Phase 1'::"text", 'Phase 2'::"text", 'Phase 3'::"text", 'All'::"text"])))
);


ALTER TABLE "public"."exercise_playlists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "phase" "text",
    "video_url" "text",
    "thumbnail_url" "text",
    "cues" "text",
    "common_errors" "text",
    "progressions" "text",
    "regressions" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "target_joints" "text"[] DEFAULT '{}'::"text"[],
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "target_area" "text",
    "difficulty" "text",
    "equipment" "text",
    "youtube_url" "text",
    "notes" "text",
    "channel_url" "text",
    "channel_name" "text",
    "is_global" boolean DEFAULT false NOT NULL,
    "source_key" "text",
    "source_file" "text",
    "source_program" "text",
    "source_section" "text",
    CONSTRAINT "exercises_category_check" CHECK ((("category" IS NULL) OR ("category" = ANY (ARRAY['Rehab'::"text", 'Mobility'::"text", 'Strength'::"text", 'Neurology'::"text", 'Breathing'::"text", 'Upper Body'::"text", 'Core'::"text", 'Lower Body'::"text"])))),
    CONSTRAINT "exercises_phase_check" CHECK (("phase" = ANY (ARRAY['Phase 1'::"text", 'Phase 2'::"text", 'Phase 3'::"text"])))
);


ALTER TABLE "public"."exercises" OWNER TO "postgres";


COMMENT ON COLUMN "public"."exercises"."is_global" IS 'Admin-shared exercise visible to all coaches. created_by IS NULL is also treated as system/global. A coach own private exercises have created_by = the coach and is_global = false.';



CREATE TABLE IF NOT EXISTS "public"."gait_assessments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "assessment_id" "uuid",
    "phase_deficiencies" "jsonb" DEFAULT '{}'::"jsonb",
    "symmetry_index" integer,
    "worst_case_scenario" "text",
    "exercise_priorities" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "gait_assessments_symmetry_index_check" CHECK ((("symmetry_index" >= 0) AND ("symmetry_index" <= 100)))
);


ALTER TABLE "public"."gait_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_acceptances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "acceptance_source" "text" NOT NULL,
    "role_at_acceptance" "text" NOT NULL,
    "terms_version" "text",
    "privacy_version" "text",
    "medical_disclaimer_version" "text",
    "health_data_consent_version" "text",
    "refund_policy_version" "text",
    "cookie_policy_version" "text",
    "ip_hash" "text",
    "user_agent_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_acceptances_acceptance_source_check" CHECK (("acceptance_source" = ANY (ARRAY['signup'::"text", 'first_login_gate'::"text", 'reaccept_version_change'::"text", 'admin_seed'::"text"]))),
    CONSTRAINT "legal_acceptances_role_at_acceptance_check" CHECK (("role_at_acceptance" = ANY (ARRAY['admin'::"text", 'coach'::"text", 'client'::"text"])))
);


ALTER TABLE "public"."legal_acceptances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_type" "text" NOT NULL,
    "version" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body_ref" "text",
    "is_required" boolean DEFAULT false NOT NULL,
    "is_current" boolean DEFAULT false NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['terms'::"text", 'privacy'::"text", 'medical_disclaimer'::"text", 'health_data_consent'::"text", 'refund'::"text", 'cookie'::"text"]))),
    CONSTRAINT "legal_documents_title_check" CHECK (("length"("btrim"("title")) > 0)),
    CONSTRAINT "legal_documents_version_check" CHECK (("length"("btrim"("version")) > 0))
);


ALTER TABLE "public"."legal_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "link_section" "text",
    "link_params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "read_at" timestamp with time zone,
    "archived" boolean DEFAULT false NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "amount_minor" integer,
    "currency" "text",
    "status" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "scrubbed_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_events_amount_minor_check" CHECK ((("amount_minor" IS NULL) OR ("amount_minor" >= 0))),
    CONSTRAINT "payment_events_currency_check" CHECK ((("currency" IS NULL) OR ("currency" ~ '^[A-Z]{3}$'::"text"))),
    CONSTRAINT "payment_events_provider_check" CHECK (("provider" = ANY (ARRAY['manual'::"text", 'paymob'::"text", 'stripe'::"text"]))),
    CONSTRAINT "payment_events_subject_type_check" CHECK (("subject_type" = ANY (ARRAY['coach_package'::"text", 'client_access'::"text"])))
);


ALTER TABLE "public"."payment_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_events" IS 'Provider-neutral payment idempotency + audit ledger (P2B). One row per provider event; UNIQUE(provider, provider_event_id) is the idempotency key. scrubbed_summary holds ONLY safe, pre-scrubbed fields — NEVER the raw webhook body, card data, tokens, or secrets. Admin-read only; writes come from the service role (webhook/RPC), which bypasses RLS.';



CREATE TABLE IF NOT EXISTS "public"."phase_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "graph_id" "uuid",
    "phase_id" "uuid",
    "client_id" "uuid",
    "client_note" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "coach_decision_at" timestamp with time zone,
    "coach_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "phase_submissions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'modified'::"text"])))
);


ALTER TABLE "public"."phase_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."privacy_settings" (
    "user_id" "uuid" NOT NULL,
    "share_progress" boolean DEFAULT false,
    "share_posts" boolean DEFAULT true,
    "allow_comments" boolean DEFAULT true,
    "visible_to" "text" DEFAULT 'coach_only'::"text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "privacy_settings_visible_to_check" CHECK (("visible_to" = ANY (ARRAY['public'::"text", 'coach_only'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."privacy_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_exercises" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "exercise_id" "uuid",
    "exercise_name" "text",
    "sets" integer,
    "reps" "text",
    "rest" "text",
    "notes" "text",
    "order_index" integer DEFAULT 0
);


ALTER TABLE "public"."program_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."program_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "department_id" "uuid" NOT NULL,
    "phase" "text" NOT NULL,
    "name" "text" NOT NULL,
    "rules_json" "jsonb" DEFAULT '[]'::"jsonb",
    "exercise_sequence" "jsonb" DEFAULT '[]'::"jsonb",
    "sets_reps_tempo" "jsonb" DEFAULT '{}'::"jsonb",
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "program_templates_phase_check" CHECK (("phase" = ANY (ARRAY['Phase 1'::"text", 'Phase 2'::"text", 'Phase 3'::"text"])))
);


ALTER TABLE "public"."program_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "title" "text" NOT NULL,
    "type" "text" DEFAULT 'workout'::"text",
    "phase" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "assessment_id" "uuid",
    "department_id" "uuid",
    "structure" "jsonb" DEFAULT '{}'::"jsonb",
    "daily_routine" "jsonb" DEFAULT '{}'::"jsonb",
    "rules_applied" "text"[],
    "youtube_playlist_used" "text",
    "sheet_url" "text",
    "artifact_html" "text",
    "rpm_graph_id" "uuid",
    CONSTRAINT "programs_type_check" CHECK (("type" = ANY (ARRAY['workout'::"text", 'rehab'::"text", 'daily_routine'::"text"])))
);


ALTER TABLE "public"."programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "program_id" "uuid",
    "log_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "overall_pain_scale" integer,
    "rpe" integer,
    "completed_exercises" "uuid"[],
    "incomplete_exercises" "uuid"[],
    "client_feedback" "text",
    "coach_notes" "text",
    "battery_contribution" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "progress_logs_overall_pain_scale_check" CHECK ((("overall_pain_scale" >= 0) AND ("overall_pain_scale" <= 10))),
    CONSTRAINT "progress_logs_rpe_check" CHECK ((("rpe" >= 1) AND ("rpe" <= 10)))
);


ALTER TABLE "public"."progress_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "assessment_id" "uuid",
    "session_date" "date" DEFAULT CURRENT_DATE,
    "rom_score" numeric(5,1),
    "control_score" numeric(5,1),
    "force_score" numeric(5,1),
    "neurology_score" numeric(5,1),
    "composite_score" numeric(5,1),
    "phase" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."progress_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pulse_alert_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "pulse_status" "text" NOT NULL,
    "severity" integer NOT NULL,
    "recipients" "uuid"[] NOT NULL,
    "reasons" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pulse_alert_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pulse_alert_state" (
    "client_id" "uuid" NOT NULL,
    "last_status" "text" NOT NULL,
    "last_severity" integer NOT NULL,
    "episode_active" boolean DEFAULT false NOT NULL,
    "episode_started_at" timestamp with time zone,
    "last_alerted_status" "text",
    "last_alerted_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pulse_alert_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rehab_objective_assessments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "toe_touch_score" integer,
    "toe_touch_observations" "text"[],
    "toe_touch_tight_muscles" "text"[],
    "ankle_df_left_cm" numeric(4,1),
    "ankle_df_right_cm" numeric(4,1),
    "ankle_pronation_left" "text",
    "ankle_pronation_right" "text",
    "ankle_supination_left" "text",
    "ankle_supination_right" "text",
    "tibia_ir_left" integer,
    "tibia_ir_right" integer,
    "hip_ir_left" integer,
    "hip_ir_right" integer,
    "hip_er_left" integer,
    "hip_er_right" integer,
    "hip_flexion_left" integer,
    "hip_flexion_right" integer,
    "hip_extension_left" integer,
    "hip_extension_right" integer,
    "hip_abduction_left" integer,
    "hip_abduction_right" integer,
    "hip_adduction_left" integer,
    "hip_adduction_right" integer,
    "spine_flexion_range" "text",
    "spine_flexion_pain" boolean DEFAULT false,
    "spine_flexion_tight_muscles" "text"[],
    "spine_extension_range" "text",
    "spine_extension_pain" boolean DEFAULT false,
    "spine_extension_tight_muscles" "text"[],
    "spine_lat_flex_left_range" "text",
    "spine_lat_flex_left_pain" boolean DEFAULT false,
    "spine_lat_flex_right_range" "text",
    "spine_lat_flex_right_pain" boolean DEFAULT false,
    "spine_rotation_left_range" "text",
    "spine_rotation_left_pain" boolean DEFAULT false,
    "spine_rotation_right_range" "text",
    "spine_rotation_right_pain" boolean DEFAULT false,
    "shoulder_flexion_left" integer,
    "shoulder_flexion_right" integer,
    "shoulder_extension_left" integer,
    "shoulder_extension_right" integer,
    "shoulder_ir_left" integer,
    "shoulder_ir_right" integer,
    "shoulder_er_left" integer,
    "shoulder_er_right" integer,
    "sl_squat_left_score" integer,
    "sl_squat_right_score" integer,
    "sl_squat_notes" "text",
    "sl_rdl_left_score" integer,
    "sl_rdl_right_score" integer,
    "sl_rdl_notes" "text",
    "oh_squat_score" integer,
    "oh_squat_notes" "text",
    "sl_balance_eo_left" integer,
    "sl_balance_eo_right" integer,
    "sl_balance_ec_left" integer,
    "sl_balance_ec_right" integer,
    "sl_reach_left" integer,
    "sl_reach_right" integer,
    "rom_score" numeric(5,1),
    "control_score" numeric(5,1),
    "force_score" numeric(5,1),
    "neurology_score" numeric(5,1),
    "composite_score" numeric(5,1),
    "phase_recommendation" "text",
    "pain_flags" "text"[],
    "asymmetry_flags" "text"[],
    "gait_flags" "text"[],
    "referral_required" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "rehab_objective_assessments_oh_squat_score_check" CHECK ((("oh_squat_score" >= 0) AND ("oh_squat_score" <= 3))),
    CONSTRAINT "rehab_objective_assessments_sl_rdl_left_score_check" CHECK ((("sl_rdl_left_score" >= 0) AND ("sl_rdl_left_score" <= 3))),
    CONSTRAINT "rehab_objective_assessments_sl_rdl_right_score_check" CHECK ((("sl_rdl_right_score" >= 0) AND ("sl_rdl_right_score" <= 3))),
    CONSTRAINT "rehab_objective_assessments_sl_squat_left_score_check" CHECK ((("sl_squat_left_score" >= 0) AND ("sl_squat_left_score" <= 3))),
    CONSTRAINT "rehab_objective_assessments_sl_squat_right_score_check" CHECK ((("sl_squat_right_score" >= 0) AND ("sl_squat_right_score" <= 3)))
);


ALTER TABLE "public"."rehab_objective_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpm_graphs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "coach_id" "uuid",
    "subjective_id" "uuid",
    "objective_id" "uuid",
    "point_a_summary" "text",
    "point_b_dream" "text",
    "inversion_question" "text",
    "phase_count" integer DEFAULT 5,
    "status" "text" DEFAULT 'draft'::"text",
    "ai_generated" boolean DEFAULT false,
    "composite_score" numeric(5,1),
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "rpm_graphs_phase_count_check" CHECK ((("phase_count" >= 3) AND ("phase_count" <= 7))),
    CONSTRAINT "rpm_graphs_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."rpm_graphs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpm_phase_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phase_id" "uuid",
    "exercise_id" "uuid",
    "prescription" "jsonb" DEFAULT '{}'::"jsonb",
    "display_order" integer DEFAULT 0,
    "ai_generated" boolean DEFAULT false,
    "client_completed" boolean DEFAULT false,
    "client_completed_at" timestamp with time zone
);


ALTER TABLE "public"."rpm_phase_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpm_phase_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "graph_id" "uuid" NOT NULL,
    "phase_id" "uuid",
    "author_id" "uuid",
    "author_role" "text",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "rpm_phase_messages_author_role_check" CHECK (("author_role" = ANY (ARRAY['coach'::"text", 'client'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."rpm_phase_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rpm_phases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "graph_id" "uuid",
    "phase_index" integer NOT NULL,
    "stage_name" "text" NOT NULL,
    "milestone_label" "text",
    "emotional_win" "text",
    "tripwire_test" "text",
    "tripwire_pass" boolean DEFAULT false,
    "load_tolerance" "text",
    "cue_mode" "text" DEFAULT 'top_down'::"text",
    "status" "text" DEFAULT 'locked'::"text",
    "ai_generated" boolean DEFAULT false,
    "unlocked_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "target_regions" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "rpm_phases_cue_mode_check" CHECK (("cue_mode" = ANY (ARRAY['top_down'::"text", 'bottom_up'::"text", 'mixed'::"text"]))),
    CONSTRAINT "rpm_phases_status_check" CHECK (("status" = ANY (ARRAY['locked'::"text", 'active'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."rpm_phases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."rpm_phases"."target_regions" IS 'Body regions this phase addresses — drives phase-aware coloring on the body map. Values from a fixed vocabulary: CervicalSpine, ThoracicSpine, LumbarSpine, Pelvis, Left/Right Shoulder|Elbow|Wrist|Hip|Knee|Ankle|Foot.';



CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid",
    "coach_id" "uuid",
    "phase" "text",
    "goal" "text",
    "output" "text",
    "form_data" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subjective_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "coach_id" "uuid",
    "assessment_id" "uuid",
    "mode" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "dream_outcome" "text",
    "external_pain" "text",
    "life_impact" "text",
    "mechanism_of_injury" "text",
    "stress_timeline" "jsonb" DEFAULT '[]'::"jsonb",
    "aggravating_factors" "jsonb" DEFAULT '[]'::"jsonb",
    "easing_factors" "jsonb" DEFAULT '[]'::"jsonb",
    "past_treatments" "jsonb" DEFAULT '[]'::"jsonb",
    "hidden_objections" "text",
    "confidence_score" integer,
    "importance_score" integer,
    "fast_start_opportunity" "text",
    "red_flag_screen" "jsonb" DEFAULT '{}'::"jsonb",
    "medications" "jsonb" DEFAULT '[]'::"jsonb",
    "yellow_flags" "text",
    "recap_notes" "text",
    "free_form_notes" "text",
    "wizard_step" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "subjective_assessments_confidence_score_check" CHECK ((("confidence_score" >= 0) AND ("confidence_score" <= 10))),
    CONSTRAINT "subjective_assessments_importance_score_check" CHECK ((("importance_score" >= 0) AND ("importance_score" <= 10))),
    CONSTRAINT "subjective_assessments_mode_check" CHECK (("mode" = ANY (ARRAY['osullivan'::"text", 'free_form'::"text"]))),
    CONSTRAINT "subjective_assessments_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'complete'::"text"]))),
    CONSTRAINT "subjective_assessments_wizard_step_check" CHECK ((("wizard_step" >= 1) AND ("wizard_step" <= 13)))
);


ALTER TABLE "public"."subjective_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "plan" integer NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "notified_7d" boolean DEFAULT false,
    "notified_exp" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "grace_days" integer DEFAULT 7 NOT NULL,
    "plan_name" "text",
    CONSTRAINT "subscriptions_end_after_start_check" CHECK (("end_date" > "start_date")),
    CONSTRAINT "subscriptions_grace_days_check" CHECK ((("grace_days" >= 0) AND ("grace_days" <= 60))),
    CONSTRAINT "subscriptions_plan_check" CHECK ((("plan" >= 1) AND ("plan" <= 60))),
    CONSTRAINT "subscriptions_plan_name_len_check" CHECK ((("plan_name" IS NULL) OR ("char_length"("plan_name") <= 80))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'pending'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."subscriptions"."grace_days" IS 'Days after end_date during which the client retains login + read access. Default 7 per platform spec.';



CREATE TABLE IF NOT EXISTS "public"."workout_exercise_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "exercise_index" integer NOT NULL,
    "exercise_name" "text" NOT NULL,
    "exercise_id" "uuid",
    "sets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "notes" "text",
    "completed" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workout_exercise_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."workout_exercise_logs"."sets" IS 'Array of { n, reps, weight, rpe? } objects — one per logged set.';



CREATE TABLE IF NOT EXISTS "public"."workout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "coach_id" "uuid",
    "program_id" "uuid",
    "workout_key" "text" NOT NULL,
    "workout_label" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_seconds" integer,
    "intensity_rating" integer,
    "session_notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "end_reason" "text",
    CONSTRAINT "workout_sessions_intensity_rating_check" CHECK ((("intensity_rating" >= 1) AND ("intensity_rating" <= 10))),
    CONSTRAINT "workout_sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'abandoned'::"text"])))
);


ALTER TABLE "public"."workout_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."workout_sessions" IS 'One row per "Start Workout" press. Closes at "Finish Workout".';



CREATE OR REPLACE VIEW "public"."v_client_progression" WITH ("security_invoker"='true') AS
 WITH "win" AS (
         SELECT (CURRENT_DATE - 29) AS "w30_start",
            (CURRENT_DATE - 6) AS "w7_start",
            CURRENT_DATE AS "today"
        ), "clients" AS (
         SELECT "profiles"."id" AS "client_id"
           FROM "public"."profiles"
          WHERE ("profiles"."role" = 'client'::"text")
        ), "w30" AS (
         SELECT "c_1"."client_id",
            "count"("s".*) FILTER (WHERE (("s"."started_at")::"date" >= "w"."w30_start")) AS "started_30d",
            "count"("s".*) FILTER (WHERE (("s"."status" = 'completed'::"text") AND (("s"."ended_at")::"date" >= "w"."w30_start"))) AS "completed_30d",
            "count"("s".*) FILTER (WHERE (("s"."status" = 'abandoned'::"text") AND (("s"."started_at")::"date" >= "w"."w30_start"))) AS "abandoned_30d",
            "avg"("s"."intensity_rating") FILTER (WHERE (("s"."status" = 'completed'::"text") AND (("s"."ended_at")::"date" >= "w"."w30_start"))) AS "avg_intensity_30d",
            "count"("s".*) FILTER (WHERE (("s"."status" = 'completed'::"text") AND ("s"."intensity_rating" >= 9) AND (("s"."ended_at")::"date" >= "w"."w30_start"))) AS "overreach_30d"
           FROM (("clients" "c_1"
             CROSS JOIN "win" "w")
             LEFT JOIN "public"."workout_sessions" "s" ON (("s"."client_id" = "c_1"."client_id")))
          GROUP BY "c_1"."client_id", "w"."w30_start"
        ), "w7" AS (
         SELECT "c_1"."client_id",
            "count"("s".*) FILTER (WHERE (("s"."status" = 'completed'::"text") AND (("s"."ended_at")::"date" >= "w"."w7_start"))) AS "completed_7d"
           FROM (("clients" "c_1"
             CROSS JOIN "win" "w")
             LEFT JOIN "public"."workout_sessions" "s" ON (("s"."client_id" = "c_1"."client_id")))
          GROUP BY "c_1"."client_id", "w"."w7_start"
        ), "ex_quality" AS (
         SELECT "s"."client_id",
            "avg"(
                CASE
                    WHEN ("cnt"."total" > 0) THEN ((("cnt"."done")::numeric / ("cnt"."total")::numeric) * (100)::numeric)
                    ELSE NULL::numeric
                END) AS "pct_completed_30d"
           FROM (("public"."workout_sessions" "s"
             CROSS JOIN "win" "w")
             LEFT JOIN LATERAL ( SELECT "count"(*) AS "total",
                    "count"(*) FILTER (WHERE ("l"."completed" = true)) AS "done"
                   FROM "public"."workout_exercise_logs" "l"
                  WHERE ("l"."session_id" = "s"."id")) "cnt" ON (true))
          WHERE (("s"."status" = 'completed'::"text") AND (("s"."ended_at")::"date" >= "w"."w30_start"))
          GROUP BY "s"."client_id"
        ), "routine_norm" AS (
         SELECT "dr"."client_id",
            "dr"."log_date",
            (COALESCE("dr"."battery_pct",
                CASE
                    WHEN "dr"."completed" THEN 100
                    ELSE 0
                END))::numeric AS "routine_pct"
           FROM "public"."daily_routine_logs" "dr"
        ), "routine" AS (
         SELECT "c_1"."client_id",
            "avg"("rn"."routine_pct") FILTER (WHERE ("rn"."log_date" >= "w"."w30_start")) AS "routine_pct_30d",
            "avg"("rn"."routine_pct") FILTER (WHERE ("rn"."log_date" >= "w"."w7_start")) AS "routine_pct_7d",
            "count"(*) FILTER (WHERE ("rn"."log_date" >= "w"."w30_start")) AS "routine_days_30d"
           FROM (("clients" "c_1"
             CROSS JOIN "win" "w")
             LEFT JOIN "routine_norm" "rn" ON (("rn"."client_id" = "c_1"."client_id")))
          GROUP BY "c_1"."client_id", "w"."w30_start", "w"."w7_start"
        ), "alt" AS (
         SELECT "c_1"."client_id",
            "count"("a".*) FILTER (WHERE ((("a"."created_at")::"date" >= "w"."w30_start") AND (NOT (("a"."status" = 'addressed'::"text") AND ("a"."substitute_exercise_id" IS NOT NULL))))) AS "alt_requests_30d"
           FROM (("clients" "c_1"
             CROSS JOIN "win" "w")
             LEFT JOIN "public"."exercise_alternative_requests" "a" ON (("a"."client_id" = "c_1"."client_id")))
          GROUP BY "c_1"."client_id", "w"."w30_start"
        ), "ex_top" AS (
         SELECT "s"."client_id",
            "l"."exercise_name",
            "s"."ended_at",
            "max"((COALESCE((("set_elem"."value" ->> 'reps'::"text"))::numeric, (0)::numeric) * COALESCE((("set_elem"."value" ->> 'weight'::"text"))::numeric, (0)::numeric))) AS "top_vol"
           FROM ((("public"."workout_sessions" "s"
             JOIN "public"."workout_exercise_logs" "l" ON (("l"."session_id" = "s"."id")))
             CROSS JOIN "win" "w")
             LEFT JOIN LATERAL "jsonb_array_elements"("l"."sets") "set_elem"("value") ON (true))
          WHERE (("s"."status" = 'completed'::"text") AND (("s"."ended_at")::"date" >= "w"."w30_start") AND ("l"."sets" IS NOT NULL) AND ("jsonb_array_length"("l"."sets") > 0))
          GROUP BY "s"."client_id", "l"."exercise_name", "s"."ended_at"
        ), "ex_progress" AS (
         SELECT "ex_top"."client_id",
            "ex_top"."exercise_name",
            "min"("ex_top"."top_vol") FILTER (WHERE ("ex_top"."top_vol" > (0)::numeric)) AS "first_vol",
            ("array_agg"("ex_top"."top_vol" ORDER BY "ex_top"."ended_at" DESC))[1] AS "last_vol",
            "count"(*) AS "sessions_logged"
           FROM "ex_top"
          GROUP BY "ex_top"."client_id", "ex_top"."exercise_name"
         HAVING ("count"(*) >= 3)
        ), "perf" AS (
         SELECT "ex_progress"."client_id",
            "avg"("public"."_clamp_score"(((40)::numeric + ((60)::numeric * ((LEAST(0.50, GREATEST('-0.20'::numeric,
                CASE
                    WHEN ("ex_progress"."first_vol" > (0)::numeric) THEN (("ex_progress"."last_vol" - "ex_progress"."first_vol") / "ex_progress"."first_vol")
                    ELSE (0)::numeric
                END)) + 0.20) / 0.70))))) AS "performance_30d",
            "count"(*) AS "exercises_tracked"
           FROM "ex_progress"
          GROUP BY "ex_progress"."client_id"
        )
 SELECT "c"."client_id",
    COALESCE("w30"."started_30d", (0)::bigint) AS "workouts_started_30d",
    COALESCE("w30"."completed_30d", (0)::bigint) AS "workouts_completed_30d",
    COALESCE("w30"."abandoned_30d", (0)::bigint) AS "workouts_abandoned_30d",
    COALESCE("w30"."overreach_30d", (0)::bigint) AS "overreach_sessions_30d",
    "round"(COALESCE("w30"."avg_intensity_30d", (0)::numeric), 1) AS "avg_intensity_30d",
    COALESCE("w7"."completed_7d", (0)::bigint) AS "workouts_completed_7d",
    "round"(COALESCE("ex_quality"."pct_completed_30d", (0)::numeric), 1) AS "exercise_completion_pct_30d",
    "round"(COALESCE("routine"."routine_pct_30d", (0)::numeric), 1) AS "routine_adherence_pct_30d",
    "round"(COALESCE("routine"."routine_pct_7d", (0)::numeric), 1) AS "routine_adherence_pct_7d",
    COALESCE("routine"."routine_days_30d", (0)::bigint) AS "routine_days_logged_30d",
    COALESCE("alt"."alt_requests_30d", (0)::bigint) AS "alt_requests_30d",
    COALESCE("perf"."exercises_tracked", (0)::bigint) AS "exercises_tracked_30d",
    "round"("public"."_clamp_score"((((0.40 * LEAST((100)::numeric, ((COALESCE("w30"."completed_30d", (0)::bigint))::numeric * (100.0 / (12)::numeric)))) + (0.40 * COALESCE("routine"."routine_pct_30d", (0)::numeric))) + (0.20 * COALESCE("ex_quality"."pct_completed_30d", (0)::numeric)))), 1) AS "compliance",
    "round"("public"."_clamp_score"(((((100 - (10 * COALESCE("w30"."overreach_30d", (0)::bigint))))::numeric - ((30)::numeric *
        CASE
            WHEN (COALESCE("w30"."started_30d", (0)::bigint) > 0) THEN ((COALESCE("w30"."abandoned_30d", (0)::bigint))::numeric / ("w30"."started_30d")::numeric)
            ELSE (0)::numeric
        END)) - ((5 * COALESCE("alt"."alt_requests_30d", (0)::bigint)))::numeric)), 1) AS "recovery",
    "round"(COALESCE("perf"."performance_30d", (50)::numeric), 1) AS "performance",
    "round"("public"."_clamp_score"((((0.40 * "public"."_clamp_score"((((0.40 * LEAST((100)::numeric, ((COALESCE("w30"."completed_30d", (0)::bigint))::numeric * (100.0 / (12)::numeric)))) + (0.40 * COALESCE("routine"."routine_pct_30d", (0)::numeric))) + (0.20 * COALESCE("ex_quality"."pct_completed_30d", (0)::numeric))))) + (0.30 * "public"."_clamp_score"(((((100 - (10 * COALESCE("w30"."overreach_30d", (0)::bigint))))::numeric - ((30)::numeric *
        CASE
            WHEN (COALESCE("w30"."started_30d", (0)::bigint) > 0) THEN ((COALESCE("w30"."abandoned_30d", (0)::bigint))::numeric / ("w30"."started_30d")::numeric)
            ELSE (0)::numeric
        END)) - ((5 * COALESCE("alt"."alt_requests_30d", (0)::bigint)))::numeric)))) + (0.30 * COALESCE("perf"."performance_30d", (50)::numeric)))), 1) AS "overall",
    "round"((COALESCE("routine"."routine_pct_7d", (0)::numeric) - COALESCE("routine"."routine_pct_30d", (0)::numeric)), 1) AS "delta_7d_routine",
    '1.1'::"text" AS "formula_version",
    "now"() AS "generated_at"
   FROM (((((("clients" "c"
     LEFT JOIN "w30" ON (("w30"."client_id" = "c"."client_id")))
     LEFT JOIN "w7" ON (("w7"."client_id" = "c"."client_id")))
     LEFT JOIN "ex_quality" ON (("ex_quality"."client_id" = "c"."client_id")))
     LEFT JOIN "routine" ON (("routine"."client_id" = "c"."client_id")))
     LEFT JOIN "alt" ON (("alt"."client_id" = "c"."client_id")))
     LEFT JOIN "perf" ON (("perf"."client_id" = "c"."client_id")));


ALTER VIEW "public"."v_client_progression" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_client_subscription_state" WITH ("security_invoker"='true') AS
 WITH "ranked" AS (
         SELECT "s"."id",
            "s"."client_id",
            "s"."plan",
            "s"."start_date",
            "s"."end_date",
            "s"."status",
            "s"."notes",
            "s"."created_by",
            "s"."notified_7d",
            "s"."notified_exp",
            "s"."created_at",
            "s"."updated_at",
            "s"."grace_days",
            "row_number"() OVER (PARTITION BY "s"."client_id" ORDER BY "s"."end_date" DESC, "s"."created_at" DESC) AS "rn"
           FROM "public"."subscriptions" "s"
        )
 SELECT "client_id",
    "id" AS "sub_id",
    "plan",
    "start_date",
    "end_date",
    "status",
    "grace_days",
    (("end_date" + (("grace_days" || ' days'::"text"))::interval))::"date" AS "grace_until",
    ("end_date" - CURRENT_DATE) AS "days_remaining",
    GREATEST(0, ((("end_date" + (("grace_days" || ' days'::"text"))::interval))::"date" - CURRENT_DATE)) AS "grace_days_left",
        CASE
            WHEN ("status" = 'pending'::"text") THEN 'pending'::"text"
            WHEN ("status" = 'expired'::"text") THEN 'expired'::"text"
            WHEN (CURRENT_DATE <= "end_date") THEN 'active'::"text"
            WHEN (CURRENT_DATE <= (("end_date" + (("grace_days" || ' days'::"text"))::interval))::"date") THEN 'grace'::"text"
            ELSE 'expired'::"text"
        END AS "effective_status",
    "created_at",
    "notes"
   FROM "ranked"
  WHERE ("rn" = 1);


ALTER VIEW "public"."v_client_subscription_state" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_client_subscription_state" IS 'One row per client (most-recent subscription). effective_status collapses (status, end_date, grace_days, today).';



CREATE OR REPLACE VIEW "public"."v_client_pulse" WITH ("security_invoker"='true') AS
 WITH "prog" AS (
         SELECT "v_client_progression"."client_id",
            "v_client_progression"."recovery",
            "v_client_progression"."routine_adherence_pct_7d",
            "v_client_progression"."routine_adherence_pct_30d",
            "v_client_progression"."workouts_completed_7d",
            "v_client_progression"."delta_7d_routine"
           FROM "public"."v_client_progression"
        ), "sub" AS (
         SELECT "v_client_subscription_state"."client_id",
            "v_client_subscription_state"."effective_status",
            "v_client_subscription_state"."grace_days_left"
           FROM "public"."v_client_subscription_state"
        ), "last_workout" AS (
         SELECT "workout_sessions"."client_id",
            "max"(COALESCE("workout_sessions"."ended_at", "workout_sessions"."started_at")) AS "last_at"
           FROM "public"."workout_sessions"
          GROUP BY "workout_sessions"."client_id"
        ), "last_routine" AS (
         SELECT "daily_routine_logs"."client_id",
            "max"("daily_routine_logs"."log_date") AS "last_date"
           FROM "public"."daily_routine_logs"
          GROUP BY "daily_routine_logs"."client_id"
        ), "snap" AS (
         SELECT "progress_snapshots"."client_id",
            ("array_agg"("progress_snapshots"."composite_score" ORDER BY "progress_snapshots"."session_date" DESC))[1] AS "composite_latest",
            ("array_agg"("progress_snapshots"."composite_score" ORDER BY "progress_snapshots"."session_date" DESC))[2] AS "composite_prev",
            "count"(*) AS "snap_count"
           FROM "public"."progress_snapshots"
          WHERE ("progress_snapshots"."composite_score" IS NOT NULL)
          GROUP BY "progress_snapshots"."client_id"
        ), "pub" AS (
         SELECT "client_programs"."client_id",
            "client_programs"."published",
            "client_programs"."published_at"
           FROM "public"."client_programs"
        ), "base" AS (
         SELECT "prog"."client_id",
            COALESCE("prog"."routine_adherence_pct_7d", (0)::numeric) AS "adherence_7d",
            COALESCE("prog"."routine_adherence_pct_30d", (0)::numeric) AS "adherence_30d",
            "prog"."recovery",
            COALESCE("prog"."workouts_completed_7d", (0)::bigint) AS "workouts_completed_7d",
            COALESCE("prog"."delta_7d_routine", (0)::numeric) AS "delta_7d_routine",
            "snap"."composite_latest",
            "snap"."composite_prev",
            COALESCE("snap"."snap_count", (0)::bigint) AS "snap_count",
            "sub"."effective_status",
            "sub"."grace_days_left",
            "pub"."published",
            "pub"."published_at",
            GREATEST("lw"."last_at", ("lr"."last_date")::timestamp with time zone) AS "last_activity_at",
                CASE
                    WHEN (GREATEST("lw"."last_at", ("lr"."last_date")::timestamp with time zone) IS NULL) THEN NULL::integer
                    ELSE (CURRENT_DATE - (GREATEST("lw"."last_at", ("lr"."last_date")::timestamp with time zone))::"date")
                END AS "days_since_activity"
           FROM ((((("prog"
             LEFT JOIN "sub" ON (("sub"."client_id" = "prog"."client_id")))
             LEFT JOIN "last_workout" "lw" ON (("lw"."client_id" = "prog"."client_id")))
             LEFT JOIN "last_routine" "lr" ON (("lr"."client_id" = "prog"."client_id")))
             LEFT JOIN "snap" ON (("snap"."client_id" = "prog"."client_id")))
             LEFT JOIN "pub" ON (("pub"."client_id" = "prog"."client_id")))
        ), "flags" AS (
         SELECT "base"."client_id",
            "base"."adherence_7d",
            "base"."adherence_30d",
            "base"."recovery",
            "base"."workouts_completed_7d",
            "base"."delta_7d_routine",
            "base"."composite_latest",
            "base"."composite_prev",
            "base"."snap_count",
            "base"."effective_status",
            "base"."grace_days_left",
            "base"."published",
            "base"."published_at",
            "base"."last_activity_at",
            "base"."days_since_activity",
            (("base"."published" IS NOT TRUE) OR ("base"."published_at" IS NULL) OR ("base"."published_at" > ("now"() - '7 days'::interval)) OR (("base"."last_activity_at" IS NULL) AND ("base"."adherence_30d" = (0)::numeric))) AS "f_new",
            (("base"."snap_count" >= 2) AND ("base"."composite_latest" IS NOT NULL) AND ("base"."composite_prev" IS NOT NULL) AND ("base"."composite_latest" <= ("base"."composite_prev" - (5)::numeric))) AS "f_regressing",
            (("base"."adherence_7d" < (40)::numeric) OR ("base"."workouts_completed_7d" = 0) OR (("base"."days_since_activity" IS NOT NULL) AND ("base"."days_since_activity" >= 14)) OR (("base"."effective_status" = ANY (ARRAY['grace'::"text", 'expired'::"text"])) AND ("base"."adherence_7d" < (50)::numeric))) AS "f_at_risk",
            ((("base"."adherence_7d" >= (40)::numeric) AND ("base"."adherence_7d" < (70)::numeric)) OR ("base"."delta_7d_routine" <= ('-15'::integer)::numeric)) AS "f_slipping"
           FROM "base"
        )
 SELECT "client_id",
        CASE
            WHEN "f_new" THEN 'new'::"text"
            WHEN "f_regressing" THEN 'regressing'::"text"
            WHEN "f_at_risk" THEN 'at_risk'::"text"
            WHEN "f_slipping" THEN 'slipping'::"text"
            ELSE 'on_track'::"text"
        END AS "pulse_status",
        CASE
            WHEN "f_new" THEN 0
            WHEN "f_regressing" THEN 4
            WHEN "f_at_risk" THEN 3
            WHEN "f_slipping" THEN 2
            ELSE 1
        END AS "severity",
    "array_remove"(ARRAY[
        CASE
            WHEN ((NOT "f_new") AND "f_regressing") THEN (('Recovery composite down '::"text" || ("round"(("composite_prev" - "composite_latest")))::"text") || ' pts'::"text")
            ELSE NULL::"text"
        END,
        CASE
            WHEN ((NOT "f_new") AND ("workouts_completed_7d" = 0)) THEN 'No completed workout in 7 days'::"text"
            ELSE NULL::"text"
        END,
        CASE
            WHEN ((NOT "f_new") AND ("days_since_activity" IS NOT NULL) AND ("days_since_activity" >= 14)) THEN (('No activity in '::"text" || ("days_since_activity")::"text") || ' days'::"text")
            ELSE NULL::"text"
        END,
        CASE
            WHEN ((NOT "f_new") AND ("adherence_7d" < (40)::numeric)) THEN (('Adherence '::"text" || ("round"("adherence_7d"))::"text") || '% this week'::"text")
            ELSE NULL::"text"
        END,
        CASE
            WHEN ((NOT "f_new") AND ("effective_status" = ANY (ARRAY['grace'::"text", 'expired'::"text"]))) THEN ('Subscription '::"text" || "effective_status")
            ELSE NULL::"text"
        END,
        CASE
            WHEN ((NOT "f_new") AND ("delta_7d_routine" <= ('-15'::integer)::numeric)) THEN 'Adherence trending down'::"text"
            ELSE NULL::"text"
        END], NULL::"text") AS "reasons",
    "adherence_7d",
    "adherence_30d",
    "recovery",
    "workouts_completed_7d",
    "delta_7d_routine",
        CASE
            WHEN ("delta_7d_routine" >= (5)::numeric) THEN 'up'::"text"
            WHEN ("delta_7d_routine" <= ('-5'::integer)::numeric) THEN 'down'::"text"
            ELSE 'flat'::"text"
        END AS "momentum",
    "composite_latest",
    "composite_prev",
        CASE
            WHEN ("composite_prev" IS NOT NULL) THEN "round"(("composite_latest" - "composite_prev"), 1)
            ELSE NULL::numeric
        END AS "composite_trend",
    "last_activity_at",
    "days_since_activity",
    "effective_status",
    "grace_days_left",
    (("effective_status" = ANY (ARRAY['grace'::"text", 'expired'::"text"])) AND ("adherence_7d" < (50)::numeric)) AS "churn_risk",
    "published_at" AS "program_published_at",
    "now"() AS "generated_at"
   FROM "flags"
  WHERE ("public"."is_admin"() OR ("client_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "flags"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid"))))));


ALTER VIEW "public"."v_client_pulse" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_client_pulse" IS 'Feature 8 S1. Read-only trajectory classifier per client. Reuses v_client_progression + v_client_subscription_state + progress_snapshots (+ recency from workout_sessions/daily_routine_logs). security_invoker so RLS auto-scopes (client=self, coach=assigned, admin=all). No writes, no new scoring math, no cron. pulse_status: new|on_track|slipping|at_risk|regressing (severity 0..4). "new" clients never alert.';



CREATE TABLE IF NOT EXISTS "public"."visitor_assessments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "visitor_id" "uuid" NOT NULL,
    "joint_pain_data" "jsonb" DEFAULT '{}'::"jsonb",
    "injury_history" "text",
    "gait_dysfunction_text" "text",
    "recommended_dept_id" "uuid",
    "recommended_coach_id" "uuid",
    "booking_status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "visitor_assessments_booking_status_check" CHECK (("booking_status" = ANY (ARRAY['pending'::"text", 'contacted'::"text", 'booked'::"text"])))
);


ALTER TABLE "public"."visitor_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visitor_inquiries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "symptoms" "text",
    "source" "text",
    "email_sent" boolean DEFAULT false,
    "ip_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "visitor_inquiries_source_check" CHECK (("source" = ANY (ARRAY['survey'::"text", 'calendly_redirect'::"text"])))
);


ALTER TABLE "public"."visitor_inquiries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "program_id" "uuid",
    "program_exercise_id" "uuid",
    "logged_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "weight_used" numeric,
    "reps_completed" "text",
    "sets_completed" integer,
    "completed" boolean DEFAULT false,
    "feedback" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."workout_logs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_feedback_log"
    ADD CONSTRAINT "ai_feedback_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_batteries"
    ADD CONSTRAINT "assessment_batteries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athlete_assessments"
    ADD CONSTRAINT "athlete_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athlete_profiles"
    ADD CONSTRAINT "athlete_profiles_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."athlete_profiles"
    ADD CONSTRAINT "athlete_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athlete_test_results"
    ADD CONSTRAINT "athlete_test_results_assessment_id_test_key_side_trial_n_key" UNIQUE ("assessment_id", "test_key", "side", "trial_n");



ALTER TABLE ONLY "public"."athlete_test_results"
    ADD CONSTRAINT "athlete_test_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."athletic_movement_observations"
    ADD CONSTRAINT "athletic_movement_observations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_map_states"
    ADD CONSTRAINT "body_map_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_shares"
    ADD CONSTRAINT "case_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_comments"
    ADD CONSTRAINT "client_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_group_members"
    ADD CONSTRAINT "client_group_members_pkey" PRIMARY KEY ("group_id", "client_id");



ALTER TABLE ONLY "public"."client_groups"
    ADD CONSTRAINT "client_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_likes"
    ADD CONSTRAINT "client_likes_pkey" PRIMARY KEY ("post_id", "user_id");



ALTER TABLE ONLY "public"."client_posts"
    ADD CONSTRAINT "client_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_program_revisions"
    ADD CONSTRAINT "client_program_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_program_versions"
    ADD CONSTRAINT "client_program_versions_client_id_effective_from_key" UNIQUE ("client_id", "effective_from");



ALTER TABLE ONLY "public"."client_program_versions"
    ADD CONSTRAINT "client_program_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_questions"
    ADD CONSTRAINT "client_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_referrals"
    ADD CONSTRAINT "client_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_routines"
    ADD CONSTRAINT "client_routines_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."client_routines"
    ADD CONSTRAINT "client_routines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_group_members"
    ADD CONSTRAINT "coach_group_members_pkey" PRIMARY KEY ("group_id", "coach_id");



ALTER TABLE ONLY "public"."coach_groups"
    ADD CONSTRAINT "coach_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_messages"
    ADD CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_peer_reviews"
    ADD CONSTRAINT "coach_peer_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_referrals"
    ADD CONSTRAINT "coach_referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coach_subscriptions"
    ADD CONSTRAINT "coach_subscriptions_coach_id_key" UNIQUE ("coach_id");



ALTER TABLE ONLY "public"."coach_subscriptions"
    ADD CONSTRAINT "coach_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_comments"
    ADD CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."community_likes"
    ADD CONSTRAINT "community_likes_pkey" PRIMARY KEY ("post_id", "user_id");



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_routine_logs"
    ADD CONSTRAINT "daily_routine_logs_client_id_log_date_key" UNIQUE ("client_id", "log_date");



ALTER TABLE ONLY "public"."daily_routine_logs"
    ADD CONSTRAINT "daily_routine_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_admins"
    ADD CONSTRAINT "department_admins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_admins"
    ADD CONSTRAINT "department_admins_user_id_department_id_key" UNIQUE ("user_id", "department_id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."exercise_alternative_requests"
    ADD CONSTRAINT "exercise_alternative_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_playlists"
    ADD CONSTRAINT "exercise_playlists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gait_assessments"
    ADD CONSTRAINT "gait_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_acceptances"
    ADD CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_documents"
    ADD CONSTRAINT "legal_documents_doc_type_version_key" UNIQUE ("doc_type", "version");



ALTER TABLE ONLY "public"."legal_documents"
    ADD CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_provider_event_uq" UNIQUE ("provider", "provider_event_id");



ALTER TABLE ONLY "public"."phase_submissions"
    ADD CONSTRAINT "phase_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."privacy_settings"
    ADD CONSTRAINT "privacy_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_exercises"
    ADD CONSTRAINT "program_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."program_templates"
    ADD CONSTRAINT "program_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_snapshots"
    ADD CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pulse_alert_log"
    ADD CONSTRAINT "pulse_alert_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pulse_alert_state"
    ADD CONSTRAINT "pulse_alert_state_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."rehab_objective_assessments"
    ADD CONSTRAINT "rehab_objective_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rpm_graphs"
    ADD CONSTRAINT "rpm_graphs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rpm_phase_exercises"
    ADD CONSTRAINT "rpm_phase_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rpm_phase_messages"
    ADD CONSTRAINT "rpm_phase_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rpm_phases"
    ADD CONSTRAINT "rpm_phases_graph_id_phase_index_key" UNIQUE ("graph_id", "phase_index");



ALTER TABLE ONLY "public"."rpm_phases"
    ADD CONSTRAINT "rpm_phases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subjective_assessments"
    ADD CONSTRAINT "subjective_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visitor_assessments"
    ADD CONSTRAINT "visitor_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visitor_inquiries"
    ADD CONSTRAINT "visitor_inquiries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_exercise_logs"
    ADD CONSTRAINT "workout_exercise_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_exercise_logs"
    ADD CONSTRAINT "workout_exercise_logs_session_id_exercise_index_key" UNIQUE ("session_id", "exercise_index");



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id");



CREATE INDEX "aer_active_substitutes_idx" ON "public"."exercise_alternative_requests" USING "btree" ("client_id", "status") WHERE (("status" = 'addressed'::"text") AND ("substitute_exercise_id" IS NOT NULL));



CREATE INDEX "aer_client_idx" ON "public"."exercise_alternative_requests" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "aer_coach_status_idx" ON "public"."exercise_alternative_requests" USING "btree" ("coach_id", "status", "created_at" DESC);



CREATE INDEX "ai_fb_coach_idx" ON "public"."ai_feedback_log" USING "btree" ("coach_id");



CREATE INDEX "ai_fb_kind_idx" ON "public"."ai_feedback_log" USING "btree" ("suggestion_kind");



CREATE INDEX "client_programs_client_idx" ON "public"."client_programs" USING "btree" ("client_id");



CREATE INDEX "client_routines_client_idx" ON "public"."client_routines" USING "btree" ("client_id");



CREATE INDEX "daily_routine_logs_client_idx" ON "public"."daily_routine_logs" USING "btree" ("client_id", "log_date" DESC);



CREATE UNIQUE INDEX "exercises_source_key_uniq" ON "public"."exercises" USING "btree" ("source_key");



CREATE INDEX "idx_appt_client" ON "public"."appointments" USING "btree" ("client_id", "starts_at" DESC);



CREATE INDEX "idx_appt_coach" ON "public"."appointments" USING "btree" ("coach_id", "starts_at" DESC);



CREATE INDEX "idx_appt_status" ON "public"."appointments" USING "btree" ("status", "starts_at" DESC);



CREATE INDEX "idx_assessments_battery" ON "public"."athlete_assessments" USING "btree" ("battery_id");



CREATE INDEX "idx_assessments_client" ON "public"."assessments" USING "btree" ("client_id");



CREATE INDEX "idx_assessments_coach" ON "public"."assessments" USING "btree" ("coach_id");



CREATE INDEX "idx_assessments_department_id" ON "public"."assessments" USING "btree" ("department_id");



CREATE INDEX "idx_assessments_status" ON "public"."athlete_assessments" USING "btree" ("status");



CREATE INDEX "idx_athlete_assessments_client" ON "public"."athlete_assessments" USING "btree" ("client_id", "assessed_at" DESC);



CREATE INDEX "idx_athlete_assessments_coach" ON "public"."athlete_assessments" USING "btree" ("coach_id");



CREATE INDEX "idx_athlete_profiles_coach" ON "public"."athlete_profiles" USING "btree" ("coach_id");



CREATE INDEX "idx_athlete_profiles_sport" ON "public"."athlete_profiles" USING "btree" ("sport", "position");



CREATE INDEX "idx_athletic_movement_observations_assessment" ON "public"."athletic_movement_observations" USING "btree" ("assessment_id");



CREATE INDEX "idx_athletic_movement_observations_client_domain" ON "public"."athletic_movement_observations" USING "btree" ("client_id", "movement_domain", "assessed_at" DESC);



CREATE INDEX "idx_athletic_movement_observations_coach" ON "public"."athletic_movement_observations" USING "btree" ("coach_id");



CREATE INDEX "idx_athletic_movement_observations_domain" ON "public"."athletic_movement_observations" USING "btree" ("movement_domain");



CREATE INDEX "idx_athletic_movement_observations_linked_test" ON "public"."athletic_movement_observations" USING "btree" ("linked_test_result_id");



CREATE INDEX "idx_athletic_movement_observations_tags" ON "public"."athletic_movement_observations" USING "gin" ("finding_tags");



CREATE INDEX "idx_batteries_coach" ON "public"."assessment_batteries" USING "btree" ("coach_id");



CREATE INDEX "idx_batteries_default" ON "public"."assessment_batteries" USING "btree" ("is_default");



CREATE INDEX "idx_body_map_client" ON "public"."body_map_states" USING "btree" ("client_id");



CREATE INDEX "idx_body_map_states_assessment_id" ON "public"."body_map_states" USING "btree" ("assessment_id");



CREATE INDEX "idx_case_shares_coach" ON "public"."case_shares" USING "btree" ("coach_id");



CREATE INDEX "idx_case_shares_status" ON "public"."case_shares" USING "btree" ("status");



CREATE INDEX "idx_client_comments_author_id" ON "public"."client_comments" USING "btree" ("author_id");



CREATE INDEX "idx_client_comments_post" ON "public"."client_comments" USING "btree" ("post_id");



CREATE INDEX "idx_client_group_members_client_id" ON "public"."client_group_members" USING "btree" ("client_id");



CREATE INDEX "idx_client_likes_user_id" ON "public"."client_likes" USING "btree" ("user_id");



CREATE INDEX "idx_client_posts_client" ON "public"."client_posts" USING "btree" ("client_id");



CREATE INDEX "idx_client_posts_type" ON "public"."client_posts" USING "btree" ("type");



CREATE INDEX "idx_client_questions_answered_by" ON "public"."client_questions" USING "btree" ("answered_by");



CREATE INDEX "idx_client_questions_assigned_coach" ON "public"."client_questions" USING "btree" ("assigned_coach_id");



CREATE INDEX "idx_client_questions_client_id" ON "public"."client_questions" USING "btree" ("client_id");



CREATE INDEX "idx_coach_group_members_coach_id" ON "public"."coach_group_members" USING "btree" ("coach_id");



CREATE INDEX "idx_coach_groups_created_by" ON "public"."coach_groups" USING "btree" ("created_by");



CREATE INDEX "idx_coach_messages_created" ON "public"."coach_messages" USING "btree" ("created_at");



CREATE INDEX "idx_coach_messages_receiver" ON "public"."coach_messages" USING "btree" ("receiver_id");



CREATE INDEX "idx_coach_messages_sender" ON "public"."coach_messages" USING "btree" ("sender_id");



CREATE INDEX "idx_coach_peer_reviews_coach_id" ON "public"."coach_peer_reviews" USING "btree" ("coach_id");



CREATE INDEX "idx_coach_referrals_client_id" ON "public"."coach_referrals" USING "btree" ("client_id");



CREATE INDEX "idx_coach_referrals_from" ON "public"."coach_referrals" USING "btree" ("from_coach_id");



CREATE INDEX "idx_coach_referrals_from_dept_id" ON "public"."coach_referrals" USING "btree" ("from_department_id");



CREATE INDEX "idx_coach_referrals_to" ON "public"."coach_referrals" USING "btree" ("to_coach_id");



CREATE INDEX "idx_coach_referrals_to_dept_id" ON "public"."coach_referrals" USING "btree" ("to_department_id");



CREATE INDEX "idx_community_comments_author_id" ON "public"."community_comments" USING "btree" ("author_id");



CREATE INDEX "idx_community_comments_post_id" ON "public"."community_comments" USING "btree" ("post_id");



CREATE INDEX "idx_community_likes_user_id" ON "public"."community_likes" USING "btree" ("user_id");



CREATE INDEX "idx_community_posts_author_id" ON "public"."community_posts" USING "btree" ("author_id");



CREATE INDEX "idx_community_posts_date" ON "public"."community_posts" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cpr_client" ON "public"."client_program_revisions" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_cpr_program" ON "public"."client_program_revisions" USING "btree" ("program_id", "revision" DESC);



CREATE INDEX "idx_cpv_client_eff" ON "public"."client_program_versions" USING "btree" ("client_id", "effective_from" DESC);



CREATE INDEX "idx_cpv_client_status" ON "public"."client_program_versions" USING "btree" ("client_id", "status");



CREATE INDEX "idx_daily_logs_client" ON "public"."daily_routine_logs" USING "btree" ("client_id", "log_date");



CREATE INDEX "idx_departments_dept_admin_id" ON "public"."departments" USING "btree" ("department_admin_id");



CREATE INDEX "idx_dept_admins_department_id" ON "public"."department_admins" USING "btree" ("department_id");



CREATE INDEX "idx_exercises_category" ON "public"."exercises" USING "btree" ("category");



CREATE INDEX "idx_exercises_created_by" ON "public"."exercises" USING "btree" ("created_by");



CREATE INDEX "idx_exercises_phase" ON "public"."exercises" USING "btree" ("phase");



CREATE INDEX "idx_exercises_tags" ON "public"."exercises" USING "gin" ("tags");



CREATE INDEX "idx_gait_assessments_assessment_id" ON "public"."gait_assessments" USING "btree" ("assessment_id");



CREATE INDEX "idx_gait_client" ON "public"."gait_assessments" USING "btree" ("client_id");



CREATE INDEX "idx_legal_acceptances_user" ON "public"."legal_acceptances" USING "btree" ("user_id");



CREATE INDEX "idx_legal_acceptances_user_accepted" ON "public"."legal_acceptances" USING "btree" ("user_id", "accepted_at" DESC);



CREATE INDEX "idx_legal_documents_doc_type_current" ON "public"."legal_documents" USING "btree" ("doc_type", "is_current");



CREATE UNIQUE INDEX "idx_legal_documents_one_current_per_type" ON "public"."legal_documents" USING "btree" ("doc_type") WHERE ("is_current" = true);



CREATE INDEX "idx_legal_documents_required_current" ON "public"."legal_documents" USING "btree" ("is_required", "is_current");



CREATE INDEX "idx_messages_receiver" ON "public"."messages" USING "btree" ("receiver_id");



CREATE INDEX "idx_messages_sender" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_profiles_coach" ON "public"."profiles" USING "btree" ("assigned_coach");



CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");



CREATE INDEX "idx_program_exercises_program_id" ON "public"."program_exercises" USING "btree" ("program_id");



CREATE INDEX "idx_program_templates_created_by" ON "public"."program_templates" USING "btree" ("created_by");



CREATE INDEX "idx_program_templates_dept_id" ON "public"."program_templates" USING "btree" ("department_id");



CREATE INDEX "idx_programs_assessment_id" ON "public"."programs" USING "btree" ("assessment_id");



CREATE INDEX "idx_programs_client" ON "public"."programs" USING "btree" ("client_id");



CREATE INDEX "idx_programs_coach_id" ON "public"."programs" USING "btree" ("coach_id");



CREATE INDEX "idx_programs_dept" ON "public"."programs" USING "btree" ("department_id");



CREATE INDEX "idx_progress_client" ON "public"."progress_snapshots" USING "btree" ("client_id");



CREATE INDEX "idx_progress_date" ON "public"."progress_snapshots" USING "btree" ("session_date");



CREATE INDEX "idx_progress_logs_client" ON "public"."progress_logs" USING "btree" ("client_id", "log_date");



CREATE INDEX "idx_progress_logs_program_id" ON "public"."progress_logs" USING "btree" ("program_id");



CREATE INDEX "idx_progress_snapshots_assessment_id" ON "public"."progress_snapshots" USING "btree" ("assessment_id");



CREATE INDEX "idx_referrals_client" ON "public"."client_referrals" USING "btree" ("client_id");



CREATE INDEX "idx_referrals_from" ON "public"."client_referrals" USING "btree" ("from_coach_id");



CREATE INDEX "idx_referrals_to" ON "public"."client_referrals" USING "btree" ("to_coach_id");



CREATE INDEX "idx_rehab_obj_assessment" ON "public"."rehab_objective_assessments" USING "btree" ("assessment_id");



CREATE INDEX "idx_results_assessment" ON "public"."athlete_test_results" USING "btree" ("assessment_id");



CREATE INDEX "idx_results_category" ON "public"."athlete_test_results" USING "btree" ("category");



CREATE INDEX "idx_results_client_cat" ON "public"."athlete_test_results" USING "btree" ("client_id", "category", "assessed_at" DESC);



CREATE INDEX "idx_results_client_test" ON "public"."athlete_test_results" USING "btree" ("client_id", "test_key", "assessed_at" DESC);



CREATE INDEX "idx_results_coach" ON "public"."athlete_test_results" USING "btree" ("coach_id");



CREATE INDEX "idx_results_test_key" ON "public"."athlete_test_results" USING "btree" ("test_key");



CREATE INDEX "idx_sessions_client" ON "public"."sessions" USING "btree" ("client_id");



CREATE INDEX "idx_sessions_coach_id" ON "public"."sessions" USING "btree" ("coach_id");



CREATE INDEX "idx_subscriptions_client" ON "public"."subscriptions" USING "btree" ("client_id");



CREATE INDEX "idx_subscriptions_created_by" ON "public"."subscriptions" USING "btree" ("created_by");



CREATE INDEX "idx_subscriptions_enddate" ON "public"."subscriptions" USING "btree" ("end_date");



CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_visitor_assessments_coach_id" ON "public"."visitor_assessments" USING "btree" ("recommended_coach_id");



CREATE INDEX "idx_visitor_assessments_dept_id" ON "public"."visitor_assessments" USING "btree" ("recommended_dept_id");



CREATE INDEX "idx_visitor_assessments_visitor_id" ON "public"."visitor_assessments" USING "btree" ("visitor_id");



CREATE INDEX "idx_workout_logs_client" ON "public"."workout_logs" USING "btree" ("client_id", "logged_date");



CREATE INDEX "idx_workout_logs_program_exercise_id" ON "public"."workout_logs" USING "btree" ("program_exercise_id");



CREATE INDEX "idx_workout_logs_program_id" ON "public"."workout_logs" USING "btree" ("program_id");



CREATE INDEX "notifications_recipient_created_idx" ON "public"."notifications" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "notifications_recipient_unread_idx" ON "public"."notifications" USING "btree" ("recipient_id") WHERE (("archived" = false) AND ("read_at" IS NULL));



CREATE INDEX "notifications_type_idx" ON "public"."notifications" USING "btree" ("type", "created_at" DESC);



CREATE INDEX "payment_events_received_idx" ON "public"."payment_events" USING "btree" ("received_at" DESC);



CREATE INDEX "payment_events_status_idx" ON "public"."payment_events" USING "btree" ("status");



CREATE INDEX "payment_events_subject_idx" ON "public"."payment_events" USING "btree" ("subject_type", "subject_id");



CREATE INDEX "phase_subm_graph_idx" ON "public"."phase_submissions" USING "btree" ("graph_id");



CREATE INDEX "phase_subm_status_idx" ON "public"."phase_submissions" USING "btree" ("status");



CREATE INDEX "profiles_assigned_coach_idx" ON "public"."profiles" USING "btree" ("assigned_coach") WHERE ("assigned_coach" IS NOT NULL);



CREATE INDEX "programs_rpm_graph_idx" ON "public"."programs" USING "btree" ("rpm_graph_id");



CREATE INDEX "rpm_graphs_client_idx" ON "public"."rpm_graphs" USING "btree" ("client_id");



CREATE INDEX "rpm_graphs_coach_idx" ON "public"."rpm_graphs" USING "btree" ("coach_id");



CREATE INDEX "rpm_graphs_status_idx" ON "public"."rpm_graphs" USING "btree" ("status");



CREATE INDEX "rpm_phase_ex_phase_idx" ON "public"."rpm_phase_exercises" USING "btree" ("phase_id");



CREATE INDEX "rpm_phase_messages_created_idx" ON "public"."rpm_phase_messages" USING "btree" ("created_at");



CREATE INDEX "rpm_phase_messages_graph_idx" ON "public"."rpm_phase_messages" USING "btree" ("graph_id");



CREATE INDEX "rpm_phase_messages_phase_idx" ON "public"."rpm_phase_messages" USING "btree" ("phase_id");



CREATE INDEX "rpm_phases_graph_idx" ON "public"."rpm_phases" USING "btree" ("graph_id");



CREATE INDEX "subj_assess_assess_idx" ON "public"."subjective_assessments" USING "btree" ("assessment_id");



CREATE INDEX "subj_assess_client_idx" ON "public"."subjective_assessments" USING "btree" ("client_id");



CREATE INDEX "subj_assess_coach_idx" ON "public"."subjective_assessments" USING "btree" ("coach_id");



CREATE UNIQUE INDEX "uq_cpv_one_active_per_client" ON "public"."client_program_versions" USING "btree" ("client_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "visitor_inquiries_created_idx" ON "public"."visitor_inquiries" USING "btree" ("created_at" DESC);



CREATE INDEX "visitor_inquiries_email_idx" ON "public"."visitor_inquiries" USING "btree" ("email");



CREATE INDEX "workout_exercise_logs_ex_idx" ON "public"."workout_exercise_logs" USING "btree" ("exercise_id") WHERE ("exercise_id" IS NOT NULL);



CREATE INDEX "workout_exercise_logs_session_idx" ON "public"."workout_exercise_logs" USING "btree" ("session_id");



CREATE INDEX "workout_sessions_client_idx" ON "public"."workout_sessions" USING "btree" ("client_id", "started_at" DESC);



CREATE INDEX "workout_sessions_coach_idx" ON "public"."workout_sessions" USING "btree" ("coach_id", "started_at" DESC);



CREATE UNIQUE INDEX "workout_sessions_one_active_uidx" ON "public"."workout_sessions" USING "btree" ("client_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "workout_sessions_status_idx" ON "public"."workout_sessions" USING "btree" ("client_id", "status");



CREATE OR REPLACE TRIGGER "coach_subscriptions_touch" BEFORE UPDATE ON "public"."coach_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_coach_subscriptions_updated_at"();



CREATE OR REPLACE TRIGGER "privacy_settings_updated" BEFORE UPDATE ON "public"."privacy_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "programs_updated_at" BEFORE UPDATE ON "public"."programs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "rpm_graphs_touch" BEFORE UPDATE ON "public"."rpm_graphs" FOR EACH ROW EXECUTE FUNCTION "public"."rpm_touch_updated_at"();



CREATE OR REPLACE TRIGGER "subj_assess_touch" BEFORE UPDATE ON "public"."subjective_assessments" FOR EACH ROW EXECUTE FUNCTION "public"."rpm_touch_updated_at"();



CREATE OR REPLACE TRIGGER "subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "tg_aer_insert" AFTER INSERT ON "public"."exercise_alternative_requests" FOR EACH ROW EXECUTE FUNCTION "public"."tg_aer_notify_coach"();



CREATE OR REPLACE TRIGGER "tg_aer_update" AFTER UPDATE OF "status" ON "public"."exercise_alternative_requests" FOR EACH ROW EXECUTE FUNCTION "public"."tg_aer_notify_client"();



CREATE OR REPLACE TRIGGER "tg_case_share_insert" AFTER INSERT ON "public"."case_shares" FOR EACH ROW EXECUTE FUNCTION "public"."tg_case_share_notify_admins"();



CREATE OR REPLACE TRIGGER "tg_case_share_update" AFTER UPDATE OF "status" ON "public"."case_shares" FOR EACH ROW EXECUTE FUNCTION "public"."tg_case_share_notify_coach"();



CREATE OR REPLACE TRIGGER "tg_phase_subm_insert" AFTER INSERT ON "public"."phase_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."tg_phase_subm_notify_coach"();



CREATE OR REPLACE TRIGGER "tg_phase_subm_update" AFTER UPDATE OF "status" ON "public"."phase_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."tg_phase_subm_notify_client"();



CREATE OR REPLACE TRIGGER "tg_profile_phase_upgrade" AFTER UPDATE OF "current_phase" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."tg_profile_phase_upgrade"();



CREATE OR REPLACE TRIGGER "tg_profiles_protect_columns" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_profile_protected_columns"();



CREATE OR REPLACE TRIGGER "trg_appt_notify" AFTER INSERT OR UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_appt_notify_client"();



CREATE OR REPLACE TRIGGER "trg_appt_touch" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_appt_touch"();



CREATE OR REPLACE TRIGGER "trg_assessments_touch" BEFORE UPDATE ON "public"."athlete_assessments" FOR EACH ROW EXECUTE FUNCTION "public"."tg_athletic_touch"();



CREATE OR REPLACE TRIGGER "trg_athlete_profiles_touch" BEFORE UPDATE ON "public"."athlete_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."tg_athletic_touch"();



CREATE OR REPLACE TRIGGER "trg_batteries_touch" BEFORE UPDATE ON "public"."assessment_batteries" FOR EACH ROW EXECUTE FUNCTION "public"."tg_athletic_touch"();



CREATE OR REPLACE TRIGGER "trg_cp_revision_set" BEFORE INSERT OR UPDATE ON "public"."client_programs" FOR EACH ROW EXECUTE FUNCTION "public"."tg_cp_revision_set"();



CREATE OR REPLACE TRIGGER "trg_cp_revision_snap" AFTER INSERT OR UPDATE ON "public"."client_programs" FOR EACH ROW EXECUTE FUNCTION "public"."tg_cp_revision_snap"();



CREATE OR REPLACE TRIGGER "trg_cpv_touch" BEFORE UPDATE ON "public"."client_program_versions" FOR EACH ROW EXECUTE FUNCTION "public"."tg_cpv_touch"();



CREATE OR REPLACE TRIGGER "trg_legal_documents_touch" BEFORE UPDATE ON "public"."legal_documents" FOR EACH ROW EXECUTE FUNCTION "public"."tg_legal_touch"();



CREATE OR REPLACE TRIGGER "trg_movement_observations_touch" BEFORE UPDATE ON "public"."athletic_movement_observations" FOR EACH ROW EXECUTE FUNCTION "public"."tg_athletic_touch"();



CREATE OR REPLACE TRIGGER "trg_results_touch" BEFORE UPDATE ON "public"."athlete_test_results" FOR EACH ROW EXECUTE FUNCTION "public"."tg_athletic_touch"();



CREATE OR REPLACE TRIGGER "workout_exercise_logs_touch" BEFORE UPDATE ON "public"."workout_exercise_logs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_workout_log_updated_at"();



ALTER TABLE ONLY "public"."ai_feedback_log"
    ADD CONSTRAINT "ai_feedback_log_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."ai_feedback_log"
    ADD CONSTRAINT "ai_feedback_log_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "public"."rpm_graphs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assessment_batteries"
    ADD CONSTRAINT "assessment_batteries_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessment_batteries"
    ADD CONSTRAINT "assessment_batteries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_assessments"
    ADD CONSTRAINT "athlete_assessments_battery_id_fkey" FOREIGN KEY ("battery_id") REFERENCES "public"."assessment_batteries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_assessments"
    ADD CONSTRAINT "athlete_assessments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athlete_assessments"
    ADD CONSTRAINT "athlete_assessments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_assessments"
    ADD CONSTRAINT "athlete_assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_profiles"
    ADD CONSTRAINT "athlete_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athlete_profiles"
    ADD CONSTRAINT "athlete_profiles_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_profiles"
    ADD CONSTRAINT "athlete_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_test_results"
    ADD CONSTRAINT "athlete_test_results_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."athlete_assessments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athlete_test_results"
    ADD CONSTRAINT "athlete_test_results_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athlete_test_results"
    ADD CONSTRAINT "athlete_test_results_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athlete_test_results"
    ADD CONSTRAINT "athlete_test_results_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athletic_movement_observations"
    ADD CONSTRAINT "athletic_movement_observations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."athlete_assessments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athletic_movement_observations"
    ADD CONSTRAINT "athletic_movement_observations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."athletic_movement_observations"
    ADD CONSTRAINT "athletic_movement_observations_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athletic_movement_observations"
    ADD CONSTRAINT "athletic_movement_observations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."athletic_movement_observations"
    ADD CONSTRAINT "athletic_movement_observations_linked_test_result_id_fkey" FOREIGN KEY ("linked_test_result_id") REFERENCES "public"."athlete_test_results"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."body_map_states"
    ADD CONSTRAINT "body_map_states_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."body_map_states"
    ADD CONSTRAINT "body_map_states_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_shares"
    ADD CONSTRAINT "case_shares_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."case_shares"
    ADD CONSTRAINT "case_shares_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_comments"
    ADD CONSTRAINT "client_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."client_comments"
    ADD CONSTRAINT "client_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."client_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_group_members"
    ADD CONSTRAINT "client_group_members_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_group_members"
    ADD CONSTRAINT "client_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."client_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_likes"
    ADD CONSTRAINT "client_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_posts"
    ADD CONSTRAINT "client_posts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_revisions"
    ADD CONSTRAINT "client_program_revisions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_revisions"
    ADD CONSTRAINT "client_program_revisions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_revisions"
    ADD CONSTRAINT "client_program_revisions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_revisions"
    ADD CONSTRAINT "client_program_revisions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."client_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_versions"
    ADD CONSTRAINT "client_program_versions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_program_versions"
    ADD CONSTRAINT "client_program_versions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_versions"
    ADD CONSTRAINT "client_program_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_program_versions"
    ADD CONSTRAINT "client_program_versions_source_program_id_fkey" FOREIGN KEY ("source_program_id") REFERENCES "public"."client_programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_programs"
    ADD CONSTRAINT "client_programs_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_questions"
    ADD CONSTRAINT "client_questions_answered_by_fkey" FOREIGN KEY ("answered_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_questions"
    ADD CONSTRAINT "client_questions_assigned_coach_id_fkey" FOREIGN KEY ("assigned_coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_questions"
    ADD CONSTRAINT "client_questions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_referrals"
    ADD CONSTRAINT "client_referrals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."client_referrals"
    ADD CONSTRAINT "client_referrals_from_coach_id_fkey" FOREIGN KEY ("from_coach_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."client_referrals"
    ADD CONSTRAINT "client_referrals_to_coach_id_fkey" FOREIGN KEY ("to_coach_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."client_routines"
    ADD CONSTRAINT "client_routines_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_routines"
    ADD CONSTRAINT "client_routines_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_group_members"
    ADD CONSTRAINT "coach_group_members_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_group_members"
    ADD CONSTRAINT "coach_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."coach_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_groups"
    ADD CONSTRAINT "coach_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."coach_messages"
    ADD CONSTRAINT "coach_messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_messages"
    ADD CONSTRAINT "coach_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_peer_reviews"
    ADD CONSTRAINT "coach_peer_reviews_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_referrals"
    ADD CONSTRAINT "coach_referrals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_referrals"
    ADD CONSTRAINT "coach_referrals_from_coach_id_fkey" FOREIGN KEY ("from_coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_referrals"
    ADD CONSTRAINT "coach_referrals_from_department_id_fkey" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_referrals"
    ADD CONSTRAINT "coach_referrals_to_coach_id_fkey" FOREIGN KEY ("to_coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_referrals"
    ADD CONSTRAINT "coach_referrals_to_department_id_fkey" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."coach_subscriptions"
    ADD CONSTRAINT "coach_subscriptions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coach_subscriptions"
    ADD CONSTRAINT "coach_subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."community_comments"
    ADD CONSTRAINT "community_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_comments"
    ADD CONSTRAINT "community_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_likes"
    ADD CONSTRAINT "community_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_likes"
    ADD CONSTRAINT "community_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_routine_logs"
    ADD CONSTRAINT "daily_routine_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_admins"
    ADD CONSTRAINT "department_admins_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."department_admins"
    ADD CONSTRAINT "department_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."departments"
    ADD CONSTRAINT "departments_department_admin_id_fkey" FOREIGN KEY ("department_admin_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_alternative_requests"
    ADD CONSTRAINT "exercise_alternative_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_alternative_requests"
    ADD CONSTRAINT "exercise_alternative_requests_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exercise_alternative_requests"
    ADD CONSTRAINT "exercise_alternative_requests_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_alternative_requests"
    ADD CONSTRAINT "exercise_alternative_requests_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."client_programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercise_alternative_requests"
    ADD CONSTRAINT "exercise_alternative_requests_substitute_exercise_id_fkey" FOREIGN KEY ("substitute_exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."gait_assessments"
    ADD CONSTRAINT "gait_assessments_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gait_assessments"
    ADD CONSTRAINT "gait_assessments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."legal_acceptances"
    ADD CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."legal_documents"
    ADD CONSTRAINT "legal_documents_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phase_submissions"
    ADD CONSTRAINT "phase_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."phase_submissions"
    ADD CONSTRAINT "phase_submissions_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "public"."rpm_graphs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phase_submissions"
    ADD CONSTRAINT "phase_submissions_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."rpm_phases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."privacy_settings"
    ADD CONSTRAINT "privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_assigned_coach_fkey" FOREIGN KEY ("assigned_coach") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_exercises"
    ADD CONSTRAINT "program_exercises_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."program_templates"
    ADD CONSTRAINT "program_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."program_templates"
    ADD CONSTRAINT "program_templates_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_rpm_graph_id_fkey" FOREIGN KEY ("rpm_graph_id") REFERENCES "public"."rpm_graphs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_logs"
    ADD CONSTRAINT "progress_logs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."progress_snapshots"
    ADD CONSTRAINT "progress_snapshots_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id");



ALTER TABLE ONLY "public"."progress_snapshots"
    ADD CONSTRAINT "progress_snapshots_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pulse_alert_log"
    ADD CONSTRAINT "pulse_alert_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pulse_alert_state"
    ADD CONSTRAINT "pulse_alert_state_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rehab_objective_assessments"
    ADD CONSTRAINT "rehab_objective_assessments_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpm_graphs"
    ADD CONSTRAINT "rpm_graphs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpm_graphs"
    ADD CONSTRAINT "rpm_graphs_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rpm_graphs"
    ADD CONSTRAINT "rpm_graphs_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "public"."rehab_objective_assessments"("id");



ALTER TABLE ONLY "public"."rpm_graphs"
    ADD CONSTRAINT "rpm_graphs_subjective_id_fkey" FOREIGN KEY ("subjective_id") REFERENCES "public"."subjective_assessments"("id");



ALTER TABLE ONLY "public"."rpm_phase_exercises"
    ADD CONSTRAINT "rpm_phase_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rpm_phase_exercises"
    ADD CONSTRAINT "rpm_phase_exercises_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."rpm_phases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpm_phase_messages"
    ADD CONSTRAINT "rpm_phase_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rpm_phase_messages"
    ADD CONSTRAINT "rpm_phase_messages_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "public"."rpm_graphs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpm_phase_messages"
    ADD CONSTRAINT "rpm_phase_messages_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "public"."rpm_phases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rpm_phases"
    ADD CONSTRAINT "rpm_phases_graph_id_fkey" FOREIGN KEY ("graph_id") REFERENCES "public"."rpm_graphs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subjective_assessments"
    ADD CONSTRAINT "subjective_assessments_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subjective_assessments"
    ADD CONSTRAINT "subjective_assessments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subjective_assessments"
    ADD CONSTRAINT "subjective_assessments_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."visitor_assessments"
    ADD CONSTRAINT "visitor_assessments_recommended_coach_id_fkey" FOREIGN KEY ("recommended_coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visitor_assessments"
    ADD CONSTRAINT "visitor_assessments_recommended_dept_id_fkey" FOREIGN KEY ("recommended_dept_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."visitor_assessments"
    ADD CONSTRAINT "visitor_assessments_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_exercise_logs"
    ADD CONSTRAINT "workout_exercise_logs_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_exercise_logs"
    ADD CONSTRAINT "workout_exercise_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_program_exercise_id_fkey" FOREIGN KEY ("program_exercise_id") REFERENCES "public"."program_exercises"("id");



ALTER TABLE ONLY "public"."workout_logs"
    ADD CONSTRAINT "workout_logs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id");



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workout_sessions"
    ADD CONSTRAINT "workout_sessions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."client_programs"("id") ON DELETE SET NULL;



CREATE POLICY "Admins insert profiles" ON "public"."profiles" FOR INSERT WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'coach'::"text"])));



CREATE POLICY "Admins update any profile" ON "public"."profiles" FOR UPDATE USING (("public"."get_my_role"() = 'admin'::"text"));



CREATE POLICY "Authenticated users comment" ON "public"."community_comments" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND ("author_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Authenticated users like" ON "public"."community_likes" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Authenticated users post" ON "public"."community_posts" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") IS NOT NULL) AND ("author_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Authenticated users view comments" ON "public"."community_comments" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "Authenticated users view community" ON "public"."community_posts" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "Authors edit own posts" ON "public"."community_posts" FOR UPDATE USING (("author_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Clients manage own workout logs" ON "public"."workout_logs" USING (("client_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Clients view own programs" ON "public"."programs" FOR SELECT USING (("client_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Clients view own subscription" ON "public"."subscriptions" FOR SELECT USING (("client_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Clients view program exercises" ON "public"."program_exercises" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."programs" "p"
  WHERE (("p"."id" = "program_exercises"."program_id") AND ("p"."client_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Coaches manage program exercises" ON "public"."program_exercises" USING ("public"."is_admin_or_coach"());



CREATE POLICY "Coaches manage programs" ON "public"."programs" USING (("public"."is_admin_or_coach"() OR ("client_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Coaches view client workout logs" ON "public"."workout_logs" FOR SELECT USING ("public"."is_admin_or_coach"());



CREATE POLICY "Users update own profile" ON "public"."profiles" FOR UPDATE USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "aer_client_insert" ON "public"."exercise_alternative_requests" FOR INSERT TO "authenticated" WITH CHECK (("client_id" = "auth"."uid"()));



CREATE POLICY "aer_client_select" ON "public"."exercise_alternative_requests" FOR SELECT TO "authenticated" USING ((("client_id" = "auth"."uid"()) OR ("coach_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "aer_client_update_pending" ON "public"."exercise_alternative_requests" FOR UPDATE TO "authenticated" USING ((("client_id" = "auth"."uid"()) AND ("status" = 'pending'::"text"))) WITH CHECK ((("client_id" = "auth"."uid"()) AND ("status" = 'pending'::"text")));



CREATE POLICY "aer_coach_update" ON "public"."exercise_alternative_requests" FOR UPDATE TO "authenticated" USING ((("coach_id" = "auth"."uid"()) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "exercise_alternative_requests"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "ai_fb_admin_read" ON "public"."ai_feedback_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "ai_fb_coach_write" ON "public"."ai_feedback_log" FOR INSERT TO "authenticated" WITH CHECK (("coach_id" = "auth"."uid"()));



ALTER TABLE "public"."ai_feedback_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appt_delete" ON "public"."appointments" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "appt_insert" ON "public"."appointments" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "appointments"."client_id") AND ("p"."assigned_coach" = "appointments"."coach_id")))) AND ("public"."is_admin"() OR (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "appt_select" ON "public"."appointments" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("client_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "appt_update" ON "public"."appointments" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid"))) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "appointments"."client_id") AND ("p"."assigned_coach" = "appointments"."coach_id"))))));



ALTER TABLE "public"."assessment_batteries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessments_all" ON "public"."athlete_assessments" TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athlete_assessments"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid"))))))))) WITH CHECK (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athlete_assessments"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "assessments_client_read" ON "public"."assessments" FOR SELECT TO "authenticated" USING (("client_id" = "auth"."uid"()));



CREATE POLICY "assessments_coach_all" ON "public"."assessments" TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "assessments"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "assessments"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."athlete_assessments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."athlete_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "athlete_profiles_all" ON "public"."athlete_profiles" TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athlete_profiles"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid"))))))))) WITH CHECK (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athlete_profiles"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))))));



ALTER TABLE "public"."athlete_test_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."athletic_movement_observations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "batteries_delete" ON "public"."assessment_batteries" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("is_default" = false))));



CREATE POLICY "batteries_insert" ON "public"."assessment_batteries" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("is_default" = false))));



CREATE POLICY "batteries_select" ON "public"."assessment_batteries" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("is_default" = true) AND "public"."is_coach_or_admin"())));



CREATE POLICY "batteries_update" ON "public"."assessment_batteries" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("is_default" = false)))) WITH CHECK (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("is_default" = false))));



ALTER TABLE "public"."body_map_states" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "body_map_states_client_read" ON "public"."body_map_states" FOR SELECT TO "authenticated" USING (("client_id" = "auth"."uid"()));



CREATE POLICY "body_map_states_coach_all" ON "public"."body_map_states" TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "body_map_states"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "body_map_states"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."case_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_shares_delete" ON "public"."case_shares" FOR DELETE USING ((("auth"."uid"() = "coach_id") OR "public"."is_admin"()));



CREATE POLICY "case_shares_insert" ON "public"."case_shares" FOR INSERT WITH CHECK (("auth"."uid"() = "coach_id"));



CREATE POLICY "case_shares_read" ON "public"."case_shares" FOR SELECT USING ((("status" = 'approved'::"text") OR ("auth"."uid"() = "coach_id") OR "public"."is_admin"()));



CREATE POLICY "case_shares_update" ON "public"."case_shares" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "cl_all" ON "public"."client_likes" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."client_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_comments_select" ON "public"."client_comments" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "author_id") OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."client_posts" "cp"
  WHERE (("cp"."id" = "client_comments"."post_id") AND ("cp"."client_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM ("public"."client_posts" "cp"
     JOIN "public"."profiles" "p" ON (("p"."id" = "cp"."client_id")))
  WHERE (("cp"."id" = "client_comments"."post_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "client_comments_write" ON "public"."client_comments" USING (((( SELECT "auth"."uid"() AS "uid") = "author_id") OR "public"."is_admin"()));



ALTER TABLE "public"."client_group_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_group_members_own" ON "public"."client_group_members" USING ((( SELECT "auth"."uid"() AS "uid") = "client_id"));



ALTER TABLE "public"."client_groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_groups_coach_write" ON "public"."client_groups" USING ("public"."is_coach_or_admin"());



CREATE POLICY "client_groups_public" ON "public"."client_groups" FOR SELECT USING (true);



ALTER TABLE "public"."client_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_posts_delete" ON "public"."client_posts" FOR DELETE USING (((( SELECT "auth"."uid"() AS "uid") = "client_id") OR "public"."is_admin"()));



CREATE POLICY "client_posts_insert" ON "public"."client_posts" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "client_id"));



CREATE POLICY "client_posts_select" ON "public"."client_posts" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "client_id") OR "public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_posts"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "client_posts_update" ON "public"."client_posts" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "client_id"));



ALTER TABLE "public"."client_program_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_program_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_programs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_programs_client_read" ON "public"."client_programs" FOR SELECT TO "authenticated" USING ((("client_id" = "auth"."uid"()) AND ("published" = true)));



CREATE POLICY "client_programs_coach_all" ON "public"."client_programs" TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_programs"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_programs"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."client_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_routines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_routines_client_read" ON "public"."client_routines" FOR SELECT TO "authenticated" USING ((("client_id" = "auth"."uid"()) AND ("published" = true)));



CREATE POLICY "client_routines_coach_all" ON "public"."client_routines" TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_routines"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_routines"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."coach_group_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_group_members_visible" ON "public"."coach_group_members" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."coach_group_members" "cgm"
  WHERE (("cgm"."group_id" = "cgm"."group_id") AND ("cgm"."coach_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR "public"."is_admin"()));



ALTER TABLE "public"."coach_groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_groups_create" ON "public"."coach_groups" USING ("public"."is_coach_or_admin"());



CREATE POLICY "coach_groups_members" ON "public"."coach_groups" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."coach_group_members"
  WHERE (("coach_group_members"."group_id" = "coach_groups"."id") AND ("coach_group_members"."coach_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR "public"."is_admin"()));



ALTER TABLE "public"."coach_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_messages_participants" ON "public"."coach_messages" USING (((( SELECT "auth"."uid"() AS "uid") = "sender_id") OR (( SELECT "auth"."uid"() AS "uid") = "receiver_id")));



ALTER TABLE "public"."coach_peer_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coach_referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coach_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "coach_subscriptions_select" ON "public"."coach_subscriptions" FOR SELECT TO "authenticated" USING ((("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



ALTER TABLE "public"."community_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cpr_select" ON "public"."client_program_revisions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_program_revisions"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "cpv_select" ON "public"."client_program_versions" FOR SELECT TO "authenticated" USING (((("client_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = 'active'::"text") AND ("published" = true) AND ("effective_from" <= "now"())) OR "public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_program_versions"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "cpv_write" ON "public"."client_program_versions" TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_program_versions"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK (("public"."is_admin"() OR ("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "client_program_versions"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "cq_answer" ON "public"."client_questions" FOR UPDATE USING ((("client_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"])))))));



CREATE POLICY "cq_insert" ON "public"."client_questions" FOR INSERT WITH CHECK (("client_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "cq_read" ON "public"."client_questions" FOR SELECT USING ((("client_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("is_public" = true) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"])))))));



ALTER TABLE "public"."daily_routine_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."departments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dept_admin_manage" ON "public"."department_admins" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "dept_admin_read" ON "public"."department_admins" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"text"))))));



CREATE POLICY "dept_admin_write" ON "public"."departments" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "dept_read_all" ON "public"."departments" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "dr_logs_client_own" ON "public"."daily_routine_logs" TO "authenticated" USING (("client_id" = "auth"."uid"())) WITH CHECK (("client_id" = "auth"."uid"()));



CREATE POLICY "dr_logs_coach_read" ON "public"."daily_routine_logs" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "daily_routine_logs"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "dr_logs_coach_update" ON "public"."daily_routine_logs" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "daily_routine_logs"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "dr_logs_coach_write" ON "public"."daily_routine_logs" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "daily_routine_logs"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."exercise_alternative_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_playlists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercises_delete" ON "public"."exercises" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "exercises_insert" ON "public"."exercises" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_coach_or_admin"() AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"())));



CREATE POLICY "exercises_select" ON "public"."exercises" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("public"."is_coach_or_admin"() AND (("created_by" IS NULL) OR ("is_global" = true))) OR (("public"."get_my_role"() = 'client'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."client_programs" "cp"
  WHERE (("cp"."client_id" = ( SELECT "auth"."uid"() AS "uid")) AND (POSITION((("exercises"."id")::"text") IN (("cp"."program")::"text")) > 0)))))));



CREATE POLICY "exercises_update" ON "public"."exercises" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("created_by" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK (("public"."is_admin"() OR ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."gait_assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gait_assessments_client_read" ON "public"."gait_assessments" FOR SELECT TO "authenticated" USING (("client_id" = "auth"."uid"()));



CREATE POLICY "gait_assessments_coach_all" ON "public"."gait_assessments" TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "gait_assessments"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "gait_assessments"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."legal_acceptances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legal_acceptances_insert" ON "public"."legal_acceptances" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "legal_acceptances_select" ON "public"."legal_acceptances" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));



ALTER TABLE "public"."legal_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legal_documents_insert" ON "public"."legal_documents" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "legal_documents_select" ON "public"."legal_documents" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "legal_documents_update" ON "public"."legal_documents" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movement_observations_all" ON "public"."athletic_movement_observations" TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athletic_movement_observations"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid"))))))))) WITH CHECK (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athletic_movement_observations"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "msg_insert" ON "public"."messages" FOR INSERT WITH CHECK (("sender_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "msg_read" ON "public"."messages" FOR SELECT USING ((("sender_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("receiver_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "msg_update" ON "public"."messages" FOR UPDATE USING (("receiver_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_no_direct_insert" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "notifications_recipient_delete" ON "public"."notifications" FOR DELETE TO "authenticated" USING ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "notifications_recipient_select" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "notifications_recipient_update" ON "public"."notifications" FOR UPDATE TO "authenticated" USING ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("recipient_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_events_admin_select" ON "public"."payment_events" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "peer_review_read" ON "public"."coach_peer_reviews" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "peer_review_write" ON "public"."coach_peer_reviews" USING ((("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"text"))))));



CREATE POLICY "phase_subm_access" ON "public"."phase_submissions" TO "authenticated" USING ((("client_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."rpm_graphs" "g"
  WHERE (("g"."id" = "phase_submissions"."graph_id") AND ("g"."coach_id" = "auth"."uid"())))) OR "public"."is_admin"()));



ALTER TABLE "public"."phase_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "playlists_coach" ON "public"."exercise_playlists" USING ("public"."is_coach_or_admin"());



CREATE POLICY "privacy_own" ON "public"."privacy_settings" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."privacy_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_scoped" ON "public"."profiles" FOR SELECT USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin") OR (( SELECT "public"."is_coach"() AS "is_coach") AND (("assigned_coach" = ( SELECT "auth"."uid"() AS "uid")) OR ("role" = ANY (ARRAY['coach'::"text", 'admin'::"text"]))))));



ALTER TABLE "public"."program_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."program_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "progress_client_all" ON "public"."progress_logs" USING (("client_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "progress_client_own" ON "public"."progress_snapshots" USING (((( SELECT "auth"."uid"() AS "uid") = "client_id") OR "public"."is_admin"()));



CREATE POLICY "progress_coach_insert" ON "public"."progress_snapshots" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "progress_snapshots"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "progress_coach_read" ON "public"."progress_logs" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "progress_logs"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "progress_coach_read" ON "public"."progress_snapshots" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "progress_snapshots"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



ALTER TABLE "public"."progress_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."progress_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pulse_alert_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pulse_alert_log_admin_read" ON "public"."pulse_alert_log" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."pulse_alert_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pulse_alert_state_admin_read" ON "public"."pulse_alert_state" FOR SELECT USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "referral_participants" ON "public"."client_referrals" USING (((( SELECT "auth"."uid"() AS "uid") = "from_coach_id") OR (( SELECT "auth"."uid"() AS "uid") = "to_coach_id") OR "public"."is_admin"()));



CREATE POLICY "referral_read" ON "public"."coach_referrals" FOR SELECT USING ((("from_coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("to_coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"text"))))));



CREATE POLICY "referral_write" ON "public"."coach_referrals" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



CREATE POLICY "rehab_obj_client_read" ON "public"."rehab_objective_assessments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assessments" "a"
  WHERE (("a"."id" = "rehab_objective_assessments"."assessment_id") AND ("a"."client_id" = "auth"."uid"())))));



CREATE POLICY "rehab_obj_coach_all" ON "public"."rehab_objective_assessments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assessments" "a"
  WHERE (("a"."id" = "rehab_objective_assessments"."assessment_id") AND ("public"."is_admin"() OR ("a"."coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "a"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assessments" "a"
  WHERE (("a"."id" = "rehab_objective_assessments"."assessment_id") AND ("public"."is_admin"() OR ("a"."coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "a"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))))));



ALTER TABLE "public"."rehab_objective_assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "results_all" ON "public"."athlete_test_results" TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athlete_test_results"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid"))))))))) WITH CHECK (("public"."is_admin"() OR ("public"."is_coach_or_admin"() AND (("coach_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "athlete_test_results"."client_id") AND ("p"."assigned_coach" = ( SELECT "auth"."uid"() AS "uid")))))))));



ALTER TABLE "public"."rpm_graphs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rpm_graphs_admin_full" ON "public"."rpm_graphs" TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rpm_graphs_client_read" ON "public"."rpm_graphs" FOR SELECT TO "authenticated" USING ((("client_id" = "auth"."uid"()) AND ("status" = 'published'::"text")));



CREATE POLICY "rpm_graphs_coach_full" ON "public"."rpm_graphs" TO "authenticated" USING (("coach_id" = "auth"."uid"()));



CREATE POLICY "rpm_phase_ex_via_phase" ON "public"."rpm_phase_exercises" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."rpm_phases" "p"
     JOIN "public"."rpm_graphs" "g" ON (("g"."id" = "p"."graph_id")))
  WHERE (("p"."id" = "rpm_phase_exercises"."phase_id") AND (("g"."coach_id" = "auth"."uid"()) OR (("g"."client_id" = "auth"."uid"()) AND ("g"."status" = 'published'::"text")) OR "public"."is_admin"())))));



ALTER TABLE "public"."rpm_phase_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rpm_phase_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rpm_phase_messages_participants" ON "public"."rpm_phase_messages" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."rpm_graphs" "g"
  WHERE (("g"."id" = "rpm_phase_messages"."graph_id") AND (("g"."coach_id" = "auth"."uid"()) OR ("g"."client_id" = "auth"."uid"()))))) OR "public"."is_admin"()));



ALTER TABLE "public"."rpm_phases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rpm_phases_via_graph" ON "public"."rpm_phases" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rpm_graphs" "g"
  WHERE (("g"."id" = "rpm_phases"."graph_id") AND (("g"."coach_id" = "auth"."uid"()) OR (("g"."client_id" = "auth"."uid"()) AND ("g"."status" = 'published'::"text")) OR "public"."is_admin"())))));



ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions_delete_admin" ON "public"."sessions" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "sessions_insert_scoped" ON "public"."sessions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (("coach_id" = "auth"."uid"()) AND "public"."is_coach_or_admin"())));



CREATE POLICY "sessions_select_scoped" ON "public"."sessions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR ("client_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "sessions"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "sessions_update_owner" ON "public"."sessions" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR ("coach_id" = "auth"."uid"())));



CREATE POLICY "subj_assess_access" ON "public"."subjective_assessments" TO "authenticated" USING ((("coach_id" = "auth"."uid"()) OR ("client_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."subjective_assessments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_admin_write" ON "public"."subscriptions" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "subscriptions_coach_read" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "subscriptions"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "templates_read" ON "public"."program_templates" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));



CREATE POLICY "templates_write" ON "public"."program_templates" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



ALTER TABLE "public"."visitor_assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visitor_coach_read" ON "public"."visitor_assessments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'coach'::"text"]))))));



ALTER TABLE "public"."visitor_inquiries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visitor_inquiries_admin_read" ON "public"."visitor_inquiries" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "visitor_inquiries_anon_insert" ON "public"."visitor_inquiries" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "visitor_own" ON "public"."visitor_assessments" USING (("visitor_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."workout_exercise_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_logs_access" ON "public"."workout_exercise_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "s"
  WHERE (("s"."id" = "workout_exercise_logs"."session_id") AND (("s"."client_id" = "auth"."uid"()) OR ("s"."coach_id" = "auth"."uid"()) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "s"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workout_sessions" "s"
  WHERE (("s"."id" = "workout_exercise_logs"."session_id") AND (("s"."client_id" = "auth"."uid"()) OR "public"."is_admin"() OR (EXISTS ( SELECT 1
           FROM "public"."profiles" "p"
          WHERE (("p"."id" = "s"."client_id") AND ("p"."assigned_coach" = "auth"."uid"())))))))));



ALTER TABLE "public"."workout_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workout_sessions_client_own" ON "public"."workout_sessions" TO "authenticated" USING (("client_id" = "auth"."uid"())) WITH CHECK (("client_id" = "auth"."uid"()));



CREATE POLICY "workout_sessions_coach_read" ON "public"."workout_sessions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "workout_sessions"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "workout_sessions_coach_update" ON "public"."workout_sessions" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR ("coach_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "workout_sessions"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



CREATE POLICY "workout_sessions_coach_write" ON "public"."workout_sessions" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "workout_sessions"."client_id") AND ("p"."assigned_coach" = "auth"."uid"()))))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."_clamp_score"("v" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_clamp_score"("v" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_clamp_score"("v" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."_profile_exists"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_profile_exists"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_profile_exists"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_coach_business_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_coach_business_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_coach_business_overview"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_coach_package"("p_coach_id" "uuid", "p_package_key" "text", "p_custom_qty" integer, "p_notes" "text", "p_billing_interval" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_coach_package"("p_coach_id" "uuid", "p_package_key" "text", "p_custom_qty" integer, "p_notes" "text", "p_billing_interval" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_coach_package"("p_coach_id" "uuid", "p_package_key" "text", "p_custom_qty" integer, "p_notes" "text", "p_billing_interval" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_paid_coach_package_period_system"("p_provider" "text", "p_provider_event_id" "text", "p_coach_id" "uuid", "p_package_key" "text", "p_client_limit" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_amount_minor" integer, "p_currency" "text", "p_payment_status" "text", "p_event_type" "text", "p_summary" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_paid_coach_package_period_system"("p_provider" "text", "p_provider_event_id" "text", "p_coach_id" "uuid", "p_package_key" "text", "p_client_limit" integer, "p_period_start" timestamp with time zone, "p_period_end" timestamp with time zone, "p_amount_minor" integer, "p_currency" "text", "p_payment_status" "text", "p_event_type" "text", "p_summary" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_subscription_expiry"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_subscription_expiry"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."coach_slot_status"("p_coach_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."coach_slot_status"("p_coach_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."coach_slot_status"("p_coach_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_onboarding"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_onboarding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_onboarding"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_client_subscription"("p_client_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_client_subscription"("p_client_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_client_subscription"("p_client_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_profile_protected_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_profile_protected_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_subscription_notifications"("p_client_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_subscription_notifications"("p_client_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_subscription_notifications"("p_client_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_my_stale_workout_sessions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_my_stale_workout_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_my_stale_workout_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_workout_sessions_all"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_workout_sessions_all"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fn_pulse_for_alerts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_pulse_for_alerts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_accepted_current_legal"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_accepted_current_legal"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_accepted_current_legal"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";



REVOKE ALL ON FUNCTION "public"."is_admin_or_coach"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin_or_coach"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_coach"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin_or_coach"() TO "anon";



REVOKE ALL ON FUNCTION "public"."is_coach"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_coach"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_coach"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_coach"() TO "anon";



REVOKE ALL ON FUNCTION "public"."is_coach_or_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_coach_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_coach_or_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_coach_or_admin"() TO "anon";



REVOKE ALL ON FUNCTION "public"."notify"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link_section" "text", "p_link_params" "jsonb", "p_severity" "text", "p_data" "jsonb", "p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link_section" "text", "p_link_params" "jsonb", "p_severity" "text", "p_data" "jsonb", "p_actor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify"("p_recipient_id" "uuid", "p_type" "text", "p_title" "text", "p_body" "text", "p_link_section" "text", "p_link_params" "jsonb", "p_severity" "text", "p_data" "jsonb", "p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ops_health_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ops_health_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ops_health_snapshot"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ops_health_snapshot_system"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ops_health_snapshot_system"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_program_version"("p_version_id" "uuid", "p_change_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_program_version"("p_version_id" "uuid", "p_change_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_program_version"("p_version_id" "uuid", "p_change_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reactivate_subscription"("p_client_id" "uuid", "p_months" integer, "p_start" "date", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reactivate_subscription"("p_client_id" "uuid", "p_months" integer, "p_start" "date", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reactivate_subscription"("p_client_id" "uuid", "p_months" integer, "p_start" "date", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_legal_acceptance"("p_versions" "jsonb", "p_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_legal_acceptance"("p_versions" "jsonb", "p_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_legal_acceptance"("p_versions" "jsonb", "p_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rpm_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."rpm_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rpm_touch_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_client_phase"("p_client_id" "uuid", "p_new_phase" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_client_phase"("p_client_id" "uuid", "p_new_phase" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_client_phase"("p_client_id" "uuid", "p_new_phase" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_aer_notify_client"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_aer_notify_client"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_aer_notify_coach"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_aer_notify_coach"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_appt_notify_client"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_appt_notify_client"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_appt_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_appt_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_athletic_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_athletic_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_case_share_notify_admins"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_case_share_notify_admins"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_case_share_notify_coach"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_case_share_notify_coach"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_cp_revision_set"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_cp_revision_set"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_cp_revision_snap"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_cp_revision_snap"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_cpv_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_cpv_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_legal_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_legal_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_phase_subm_notify_client"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_phase_subm_notify_client"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_phase_subm_notify_coach"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_phase_subm_notify_coach"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tg_profile_phase_upgrade"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tg_profile_phase_upgrade"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_coach_subscriptions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_coach_subscriptions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_coach_subscriptions_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."touch_workout_log_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."touch_workout_log_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_client_subscription"("p_subscription_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text", "p_grace_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_client_subscription"("p_subscription_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text", "p_grace_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_client_subscription"("p_subscription_id" "uuid", "p_plan_name" "text", "p_months" integer, "p_start" "date", "p_end" "date", "p_status" "text", "p_notes" "text", "p_grace_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_cron_secret"("p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_cron_secret"("p_secret" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_ops_health_secret"("p_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_ops_health_secret"("p_secret" "text") TO "service_role";



GRANT ALL ON TABLE "public"."ai_feedback_log" TO "anon";
GRANT ALL ON TABLE "public"."ai_feedback_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_feedback_log" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_batteries" TO "anon";
GRANT ALL ON TABLE "public"."assessment_batteries" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_batteries" TO "service_role";



GRANT ALL ON TABLE "public"."assessments" TO "anon";
GRANT ALL ON TABLE "public"."assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."assessments" TO "service_role";



GRANT ALL ON TABLE "public"."athlete_assessments" TO "anon";
GRANT ALL ON TABLE "public"."athlete_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."athlete_profiles" TO "anon";
GRANT ALL ON TABLE "public"."athlete_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."athlete_test_results" TO "anon";
GRANT ALL ON TABLE "public"."athlete_test_results" TO "authenticated";
GRANT ALL ON TABLE "public"."athlete_test_results" TO "service_role";



GRANT ALL ON TABLE "public"."athletic_movement_observations" TO "anon";
GRANT ALL ON TABLE "public"."athletic_movement_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."athletic_movement_observations" TO "service_role";



GRANT ALL ON TABLE "public"."body_map_states" TO "anon";
GRANT ALL ON TABLE "public"."body_map_states" TO "authenticated";
GRANT ALL ON TABLE "public"."body_map_states" TO "service_role";



GRANT ALL ON TABLE "public"."case_shares" TO "anon";
GRANT ALL ON TABLE "public"."case_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."case_shares" TO "service_role";



GRANT ALL ON TABLE "public"."client_comments" TO "anon";
GRANT ALL ON TABLE "public"."client_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."client_comments" TO "service_role";



GRANT ALL ON TABLE "public"."client_group_members" TO "anon";
GRANT ALL ON TABLE "public"."client_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."client_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."client_groups" TO "anon";
GRANT ALL ON TABLE "public"."client_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."client_groups" TO "service_role";



GRANT ALL ON TABLE "public"."client_likes" TO "anon";
GRANT ALL ON TABLE "public"."client_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."client_likes" TO "service_role";



GRANT ALL ON TABLE "public"."client_posts" TO "anon";
GRANT ALL ON TABLE "public"."client_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."client_posts" TO "service_role";



GRANT ALL ON TABLE "public"."client_program_revisions" TO "anon";
GRANT ALL ON TABLE "public"."client_program_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."client_program_revisions" TO "service_role";



GRANT ALL ON TABLE "public"."client_program_versions" TO "anon";
GRANT ALL ON TABLE "public"."client_program_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."client_program_versions" TO "service_role";



GRANT ALL ON TABLE "public"."client_programs" TO "anon";
GRANT ALL ON TABLE "public"."client_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."client_programs" TO "service_role";



GRANT ALL ON TABLE "public"."client_questions" TO "anon";
GRANT ALL ON TABLE "public"."client_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."client_questions" TO "service_role";



GRANT ALL ON TABLE "public"."client_referrals" TO "anon";
GRANT ALL ON TABLE "public"."client_referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."client_referrals" TO "service_role";



GRANT ALL ON TABLE "public"."client_routines" TO "anon";
GRANT ALL ON TABLE "public"."client_routines" TO "authenticated";
GRANT ALL ON TABLE "public"."client_routines" TO "service_role";



GRANT ALL ON TABLE "public"."coach_group_members" TO "anon";
GRANT ALL ON TABLE "public"."coach_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."coach_groups" TO "anon";
GRANT ALL ON TABLE "public"."coach_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_groups" TO "service_role";



GRANT ALL ON TABLE "public"."coach_messages" TO "anon";
GRANT ALL ON TABLE "public"."coach_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_messages" TO "service_role";



GRANT ALL ON TABLE "public"."coach_peer_reviews" TO "anon";
GRANT ALL ON TABLE "public"."coach_peer_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_peer_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."coach_referrals" TO "anon";
GRANT ALL ON TABLE "public"."coach_referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_referrals" TO "service_role";



GRANT ALL ON TABLE "public"."coach_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."coach_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."coach_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."community_comments" TO "anon";
GRANT ALL ON TABLE "public"."community_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."community_comments" TO "service_role";



GRANT ALL ON TABLE "public"."community_likes" TO "anon";
GRANT ALL ON TABLE "public"."community_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."community_likes" TO "service_role";



GRANT ALL ON TABLE "public"."community_posts" TO "anon";
GRANT ALL ON TABLE "public"."community_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."community_posts" TO "service_role";



GRANT ALL ON TABLE "public"."daily_routine_logs" TO "anon";
GRANT ALL ON TABLE "public"."daily_routine_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_routine_logs" TO "service_role";



GRANT ALL ON TABLE "public"."department_admins" TO "anon";
GRANT ALL ON TABLE "public"."department_admins" TO "authenticated";
GRANT ALL ON TABLE "public"."department_admins" TO "service_role";



GRANT ALL ON TABLE "public"."departments" TO "anon";
GRANT ALL ON TABLE "public"."departments" TO "authenticated";
GRANT ALL ON TABLE "public"."departments" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_alternative_requests" TO "anon";
GRANT ALL ON TABLE "public"."exercise_alternative_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_alternative_requests" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_playlists" TO "anon";
GRANT ALL ON TABLE "public"."exercise_playlists" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_playlists" TO "service_role";



GRANT ALL ON TABLE "public"."exercises" TO "anon";
GRANT ALL ON TABLE "public"."exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."exercises" TO "service_role";



GRANT ALL ON TABLE "public"."gait_assessments" TO "anon";
GRANT ALL ON TABLE "public"."gait_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."gait_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."legal_acceptances" TO "anon";
GRANT ALL ON TABLE "public"."legal_acceptances" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_acceptances" TO "service_role";



GRANT ALL ON TABLE "public"."legal_documents" TO "anon";
GRANT ALL ON TABLE "public"."legal_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_documents" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payment_events" TO "anon";
GRANT ALL ON TABLE "public"."payment_events" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_events" TO "service_role";



GRANT ALL ON TABLE "public"."phase_submissions" TO "anon";
GRANT ALL ON TABLE "public"."phase_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."phase_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."privacy_settings" TO "anon";
GRANT ALL ON TABLE "public"."privacy_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."privacy_settings" TO "service_role";



GRANT ALL ON TABLE "public"."program_exercises" TO "anon";
GRANT ALL ON TABLE "public"."program_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."program_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."program_templates" TO "anon";
GRANT ALL ON TABLE "public"."program_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."program_templates" TO "service_role";



GRANT ALL ON TABLE "public"."programs" TO "anon";
GRANT ALL ON TABLE "public"."programs" TO "authenticated";
GRANT ALL ON TABLE "public"."programs" TO "service_role";



GRANT ALL ON TABLE "public"."progress_logs" TO "anon";
GRANT ALL ON TABLE "public"."progress_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_logs" TO "service_role";



GRANT ALL ON TABLE "public"."progress_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."progress_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."pulse_alert_log" TO "anon";
GRANT ALL ON TABLE "public"."pulse_alert_log" TO "authenticated";
GRANT ALL ON TABLE "public"."pulse_alert_log" TO "service_role";



GRANT ALL ON TABLE "public"."pulse_alert_state" TO "anon";
GRANT ALL ON TABLE "public"."pulse_alert_state" TO "authenticated";
GRANT ALL ON TABLE "public"."pulse_alert_state" TO "service_role";



GRANT ALL ON TABLE "public"."rehab_objective_assessments" TO "anon";
GRANT ALL ON TABLE "public"."rehab_objective_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."rehab_objective_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."rpm_graphs" TO "anon";
GRANT ALL ON TABLE "public"."rpm_graphs" TO "authenticated";
GRANT ALL ON TABLE "public"."rpm_graphs" TO "service_role";



GRANT ALL ON TABLE "public"."rpm_phase_exercises" TO "anon";
GRANT ALL ON TABLE "public"."rpm_phase_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."rpm_phase_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."rpm_phase_messages" TO "anon";
GRANT ALL ON TABLE "public"."rpm_phase_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."rpm_phase_messages" TO "service_role";



GRANT ALL ON TABLE "public"."rpm_phases" TO "anon";
GRANT ALL ON TABLE "public"."rpm_phases" TO "authenticated";
GRANT ALL ON TABLE "public"."rpm_phases" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."subjective_assessments" TO "anon";
GRANT ALL ON TABLE "public"."subjective_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."subjective_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."workout_exercise_logs" TO "anon";
GRANT ALL ON TABLE "public"."workout_exercise_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_exercise_logs" TO "service_role";



GRANT ALL ON TABLE "public"."workout_sessions" TO "anon";
GRANT ALL ON TABLE "public"."workout_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."v_client_progression" TO "anon";
GRANT ALL ON TABLE "public"."v_client_progression" TO "authenticated";
GRANT ALL ON TABLE "public"."v_client_progression" TO "service_role";



GRANT ALL ON TABLE "public"."v_client_subscription_state" TO "anon";
GRANT ALL ON TABLE "public"."v_client_subscription_state" TO "authenticated";
GRANT ALL ON TABLE "public"."v_client_subscription_state" TO "service_role";



GRANT ALL ON TABLE "public"."v_client_pulse" TO "anon";
GRANT ALL ON TABLE "public"."v_client_pulse" TO "authenticated";
GRANT ALL ON TABLE "public"."v_client_pulse" TO "service_role";



GRANT ALL ON TABLE "public"."visitor_assessments" TO "anon";
GRANT ALL ON TABLE "public"."visitor_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."visitor_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."visitor_inquiries" TO "anon";
GRANT ALL ON TABLE "public"."visitor_inquiries" TO "authenticated";
GRANT ALL ON TABLE "public"."visitor_inquiries" TO "service_role";



GRANT ALL ON TABLE "public"."workout_logs" TO "anon";
GRANT ALL ON TABLE "public"."workout_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_logs" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







