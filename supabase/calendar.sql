-- =====================================================================
-- Kalender-Abo (ICS): privater Link pro Person für Google/Apple/Outlook
-- Einfügen in: SQL Editor → Run (wiederholbar)
-- =====================================================================
create table if not exists public.calendar_tokens (
  user_id    uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  token      uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
drop policy if exists "cal_own" on public.calendar_tokens;
create policy "cal_own" on public.calendar_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Eigenen Token holen bzw. anlegen
create or replace function public.my_calendar_token()
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  insert into public.calendar_tokens (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select token into t from public.calendar_tokens where user_id = auth.uid();
  return t;
end $$;

-- Neuen Token erzeugen (alter Link wird ungültig)
create or replace function public.rotate_calendar_token()
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  insert into public.calendar_tokens (user_id) values (auth.uid())
  on conflict (user_id) do update set token = gen_random_uuid(), created_at = now()
  returning token into t;
  return t;
end $$;

-- Cons für einen Token: Favoriten + "Will hin" der Person (nur über den geheimen Token erreichbar)
create or replace function public.calendar_feed(p_token uuid)
returns table (slug text, name text, start_date date, end_date date, city text, address text,
               url text, description text, status text, deadlines jsonb, updated_at timestamptz,
               is_fav boolean, going boolean)
language sql stable security definer set search_path = public as $$
  with u as (select user_id from public.calendar_tokens where token = p_token)
  select c.slug, c.name, c.start_date, c.end_date, c.city, c.address, c.url, c.description, c.status,
         c.deadlines, c.updated_at,
         exists (select 1 from public.favorites f where f.con_id = c.id and f.user_id = u.user_id),
         exists (select 1 from public.attendance a where a.con_id = c.id and a.user_id = u.user_id and a.status = 'ja')
  from public.cons c, u
  where exists (select 1 from public.favorites f where f.con_id = c.id and f.user_id = u.user_id)
     or exists (select 1 from public.attendance a where a.con_id = c.id and a.user_id = u.user_id and a.status = 'ja');
$$;

revoke all on function public.calendar_feed(uuid) from public;
grant execute on function public.calendar_feed(uuid) to anon, authenticated;
revoke all on function public.my_calendar_token() from public, anon;
revoke all on function public.rotate_calendar_token() from public, anon;
grant execute on function public.my_calendar_token() to authenticated;
grant execute on function public.rotate_calendar_token() to authenticated;
