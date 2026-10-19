create table public.cm_profiles (
 id uuid primary key default gen_random_uuid(), auth_id uuid unique references auth.users(id),
 name text not null, email text not null unique, role text not null check(role in ('Administrador','Gestor','Colaborador')),
 all_companies boolean not null default false, companies text[] not null default '{}',active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.cm_invites (
 token_hash text primary key, profile_id uuid not null references public.cm_profiles(id),
 expires_at timestamptz not null, status text not null default 'pending' check(status in ('pending','processing','accepted','revoked')),
 created_by uuid references public.cm_profiles(id), created_at timestamptz not null default now(),used_at timestamptz
);
create index cm_invites_profile on public.cm_invites(profile_id);
create table public.cm_state (id integer primary key check(id=1), version bigint not null default 0, data jsonb not null,updated_at timestamptz not null default now());
create table public.cm_audit(id bigint generated always as identity primary key,actor uuid references public.cm_profiles(id),action text not null,created_at timestamptz not null default now());
alter table public.cm_profiles enable row level security;
alter table public.cm_invites enable row level security;
alter table public.cm_state enable row level security;
alter table public.cm_audit enable row level security;
revoke all on public.cm_profiles,public.cm_invites,public.cm_state,public.cm_audit from anon,authenticated;
grant all on public.cm_profiles,public.cm_invites,public.cm_state,public.cm_audit to service_role;
grant usage,select on sequence public.cm_audit_id_seq to service_role;
insert into public.cm_state(id,data) values(1,'{"companies":[{"id":"quantis","name":"Empresa Alfa"},{"id":"frotlog","name":"Empresa Beta"},{"id":"lb","name":"Empresa Gama"}],"products":[],"users":[],"contracts":[],"invoices":[],"goals":[],"extraCommissions":[],"commissionPayments":{},"commissionPaymentDetails":{},"commissionEdits":{},"commissionHistory":[]}');

create policy server_only on public.cm_profiles for all to anon, authenticated using(false) with check(false);
create policy server_only on public.cm_invites for all to anon, authenticated using(false) with check(false);
create policy server_only on public.cm_state for all to anon, authenticated using(false) with check(false);
create policy server_only on public.cm_audit for all to anon, authenticated using(false) with check(false);
