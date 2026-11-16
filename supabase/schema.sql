-- =====================================================================
-- Con-Kalender – Datenbankschema für Supabase
-- Einfügen in: Supabase-Dashboard → SQL Editor → New query → Run
-- Das Skript ist wiederholbar (idempotent).
-- =====================================================================

-- ---------- Profile (ein Eintrag pro eingeloggter Person) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null default 'Neu',
  home_label  text,                 -- z. B. "Bochum"
  home_lat    double precision,
  home_lon    double precision,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Profil automatisch anlegen, wenn jemand sich zum ersten Mal einloggt
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hilfsfunktion: ist die aktuelle Person Admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Cons ----------
create table if not exists public.cons (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,          -- z. B. "feencon-2027"
  name         text not null,
  start_date   date,
  end_date     date,
  date_note    text,                          -- z. B. "Termin noch nicht bestätigt"
  city         text,
  address      text,
  country      text default 'DE',
  lat          double precision,
  lon          double precision,
  url          text,
  description  text,
  tags         text[] not null default '{}',
  price        text,
  lodging      text,
  deadlines    jsonb not null default '[]',  -- [{ "label": "Spielrunden-Anmeldung", "date": "2027-03-01" }]
  status       text not null default 'angekündigt'
               check (status in ('angekündigt','bestätigt','abgesagt')),
  source       text not null default 'web',   -- 'repo' = wird aus data/cons.json synchronisiert
  checked_at   date,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists cons_start_idx on public.cons (start_date);

-- ---------- Teilnahme (für Freunde sichtbar) ----------
create table if not exists public.attendance (
  con_id     uuid not null references public.cons(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  status     text not null check (status in ('ja','vielleicht','nein','war_da')),
  updated_at timestamptz not null default now(),
  primary key (con_id, user_id)
);

-- ---------- Favoriten (nur für einen selbst sichtbar) ----------
create table if not exists public.favorites (
  con_id     uuid not null references public.cons(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (con_id, user_id)
);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles   enable row level security;
alter table public.cons       enable row level security;
alter table public.attendance enable row level security;
alter table public.favorites  enable row level security;

-- Alte Policies entfernen (für Wiederholbarkeit)
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('profiles','cons','attendance','favorites')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- Profile: Eingeloggte sehen Spitznamen der anderen; jeder ändert nur sein eigenes Profil.
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));

-- Cons: öffentlich lesbar (Con-Termine sind öffentliche Infos).
create policy "cons_select_all" on public.cons for select to anon, authenticated using (true);
-- Eintragen: alle Eingeloggten. Ändern/Löschen: Ersteller oder Admin.
create policy "cons_insert" on public.cons for insert to authenticated with check (created_by = auth.uid());
create policy "cons_update" on public.cons for update to authenticated
  using (public.is_admin() or created_by = auth.uid());
create policy "cons_delete" on public.cons for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- Teilnahme: nur Eingeloggte sehen sie; jeder schreibt nur seine eigene.
create policy "att_select" on public.attendance for select to authenticated using (true);
create policy "att_insert" on public.attendance for insert to authenticated with check (user_id = auth.uid());
create policy "att_update" on public.attendance for update to authenticated using (user_id = auth.uid());
create policy "att_delete" on public.attendance for delete to authenticated using (user_id = auth.uid());

-- Favoriten: komplett privat.
create policy "fav_all_own" on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- updated_at automatisch pflegen
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists cons_touch on public.cons;
create trigger cons_touch before update on public.cons for each row execute function public.touch_updated_at();

-- =====================================================================
-- Con-Anfragen: nur den Namen eingeben, Claude recherchiert den Rest
-- Ablauf: Seite → con_requests → GitHub Action legt Issue an → Claude
-- recherchiert, trägt in data/cons.json ein und schließt das Issue.
-- =====================================================================
create table if not exists public.con_requests (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  note         text,
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  status       text not null default 'offen'
               check (status in ('offen','in Arbeit','erledigt','nicht gefunden')),
  issue_number int,
  created_at   timestamptz not null default now()
);
alter table public.con_requests enable row level security;
drop policy if exists "req_select" on public.con_requests;
drop policy if exists "req_insert" on public.con_requests;
drop policy if exists "req_delete" on public.con_requests;
create policy "req_select" on public.con_requests for select to authenticated using (true);
create policy "req_insert" on public.con_requests for insert to authenticated with check (requested_by = auth.uid());
create policy "req_delete" on public.con_requests for delete to authenticated
  using (requested_by = auth.uid() and status = 'offen');
