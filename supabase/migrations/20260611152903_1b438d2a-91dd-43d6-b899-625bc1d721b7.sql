
-- =========================================================
-- Tabelas: clients, monitored_groups, monitor_settings
-- =========================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- clients ----------
create table public.clients (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  phone text,
  me_name text,
  has_session boolean not null default false,
  photo_url text,
  schedule_ras text,
  schedule_fim text,
  schedule_env text,
  pinned boolean not null default false,
  weekdays integer[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.clients to authenticated;
grant all on public.clients to service_role;

alter table public.clients enable row level security;

create policy "own clients select" on public.clients for select to authenticated using (auth.uid() = user_id);
create policy "own clients insert" on public.clients for insert to authenticated with check (auth.uid() = user_id);
create policy "own clients update" on public.clients for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own clients delete" on public.clients for delete to authenticated using (auth.uid() = user_id);

create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

create index clients_user_id_idx on public.clients(user_id);

-- ---------- monitored_groups ----------
create table public.monitored_groups (
  id text not null,
  client_id text not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  input text not null,
  name text not null,
  message text not null default '',
  active boolean not null default true,
  added_at timestamptz not null default now(),
  photo_url text,
  open_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (client_id, id)
);

grant select, insert, update, delete on public.monitored_groups to authenticated;
grant all on public.monitored_groups to service_role;

alter table public.monitored_groups enable row level security;

create policy "own groups select" on public.monitored_groups for select to authenticated using (auth.uid() = user_id);
create policy "own groups insert" on public.monitored_groups for insert to authenticated with check (auth.uid() = user_id);
create policy "own groups update" on public.monitored_groups for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own groups delete" on public.monitored_groups for delete to authenticated using (auth.uid() = user_id);

create trigger monitored_groups_updated_at before update on public.monitored_groups
  for each row execute function public.set_updated_at();

create index monitored_groups_client_idx on public.monitored_groups(client_id);
create index monitored_groups_user_idx on public.monitored_groups(user_id);

-- ---------- monitor_settings ----------
create table public.monitor_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_stop boolean not null default true,
  show_clock boolean not null default true,
  show_group_icons boolean not null default true,
  sound boolean not null default true,
  show_password_calc boolean not null default true,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.monitor_settings to authenticated;
grant all on public.monitor_settings to service_role;

alter table public.monitor_settings enable row level security;

create policy "own settings select" on public.monitor_settings for select to authenticated using (auth.uid() = user_id);
create policy "own settings insert" on public.monitor_settings for insert to authenticated with check (auth.uid() = user_id);
create policy "own settings update" on public.monitor_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings delete" on public.monitor_settings for delete to authenticated using (auth.uid() = user_id);

create trigger monitor_settings_updated_at before update on public.monitor_settings
  for each row execute function public.set_updated_at();

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.monitored_groups;
alter publication supabase_realtime add table public.monitor_settings;
