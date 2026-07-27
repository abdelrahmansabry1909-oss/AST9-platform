-- Restore the repository definition for the auth.users -> profiles trigger.
-- A public-only schema dump cannot include triggers owned by the auth schema.
-- If production already has an enabled trigger calling handle_new_user(), this
-- migration is deliberately a no-op and cannot create a duplicate callback.

do $$
begin
  if to_regprocedure('public.handle_new_user()') is null then
    raise exception 'public.handle_new_user() must exist before creating the auth trigger';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgfoid = 'public.handle_new_user()'::regprocedure
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and (t.tgtype & 1) = 1
      and (t.tgtype & 2) = 0
      and (t.tgtype & 4) = 4
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
end;
$$;
