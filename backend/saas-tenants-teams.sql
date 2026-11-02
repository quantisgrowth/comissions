-- ==============================================================================
-- SAAS MIGRATION: TENANTS, TEAMS AND PRODUCT COMMISSION RULES
-- Este script é 100% aditivo e seguro: não altera nem apaga dados existentes.
-- Execute no SQL Editor do Supabase.
-- ==============================================================================

begin;

-- 1. Tabela de Tenants (Organizações / Empresas Clientes do SaaS)
create table if not exists public.cm_tenants (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
    name text not null check (char_length(name) between 2 and 150),
    legal_name text,
    document_cnpj text,
    active boolean not null default true,
    plan text not null default 'standard',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Inserir tenant padrão inicial para associar todos os cadastros e dados legados
insert into public.cm_tenants (id, slug, name, plan)
values ('00000000-0000-0000-0000-000000000001', 'quantis-group', 'Quantis Group', 'enterprise')
on conflict (slug) do nothing;

-- 2. Extensão de cm_profiles com tenant_id e flag is_superadmin
alter table public.cm_profiles 
    add column if not exists tenant_id uuid references public.cm_tenants(id),
    add column if not exists is_superadmin boolean not null default false;

-- Vincula perfis existentes que estiverem sem tenant ao tenant inicial padrão
update public.cm_profiles 
set tenant_id = '00000000-0000-0000-0000-000000000001' 
where tenant_id is null;

create index if not exists cm_profiles_tenant_idx on public.cm_profiles(tenant_id);

-- 3. Tabela de Times Comerciais por Empresa do Tenant
create table if not exists public.cm_teams (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    company_id text not null check (company_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    name text not null check (char_length(name) between 2 and 100),
    active boolean not null default true,
    created_at timestamptz not null default now()
);
create index if not exists cm_teams_tenant_idx on public.cm_teams(tenant_id, company_id);

-- 4. Membros do Time Comercial e seus papéis na equipe
create table if not exists public.cm_team_members (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    team_id uuid not null references public.cm_teams(id) on delete cascade,
    profile_id uuid not null references public.cm_profiles(id) on delete cascade,
    commercial_role text not null check (commercial_role in ('closer', 'sdr', 'leader', 'bdr', 'account_manager')),
    active boolean not null default true,
    unique(team_id, profile_id)
);
create index if not exists cm_team_members_team_idx on public.cm_team_members(team_id);
create index if not exists cm_team_members_profile_idx on public.cm_team_members(profile_id);

-- 5. Catálogo de Produtos autorizados por Time Comercial
create table if not exists public.cm_team_products (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    team_id uuid not null references public.cm_teams(id) on delete cascade,
    product_id text not null check (product_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    unique(team_id, product_id)
);
create index if not exists cm_team_products_idx on public.cm_team_products(team_id, product_id);

-- 6. Regras de Comissão Dinâmicas (por Produto e Cargo no Time)
create table if not exists public.cm_commission_rules (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    product_id text not null check (product_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    team_id uuid references public.cm_teams(id) on delete cascade, -- Nulo significa regra padrão do produto
    role_target text not null check (role_target in ('closer', 'sdr', 'leader', 'bdr', 'account_manager', 'dev', 'partner')),
    first_fee_percent numeric(5,2) not null default 0 check (first_fee_percent between 0 and 100),
    next_fee_percent numeric(5,2) not null default 0 check (next_fee_percent between 0 and 100),
    setup_percent numeric(5,2) not null default 0 check (setup_percent between 0 and 100),
    months integer not null default 6 check (months between 1 and 120),
    created_at timestamptz not null default now()
);
create index if not exists cm_commission_rules_lookup_idx on public.cm_commission_rules(tenant_id, product_id, team_id, role_target);

-- 7. Configurações de RLS e Permissões Seguras
alter table public.cm_tenants enable row level security;
alter table public.cm_teams enable row level security;
alter table public.cm_team_members enable row level security;
alter table public.cm_team_products enable row level security;
alter table public.cm_commission_rules enable row level security;

revoke all on public.cm_tenants, public.cm_teams, public.cm_team_members, public.cm_team_products, public.cm_commission_rules from anon, authenticated;
grant all on public.cm_tenants, public.cm_teams, public.cm_team_members, public.cm_team_products, public.cm_commission_rules to service_role;

drop policy if exists server_only on public.cm_tenants;
create policy server_only on public.cm_tenants for all to anon, authenticated using(false) with check(false);

drop policy if exists server_only on public.cm_teams;
create policy server_only on public.cm_teams for all to anon, authenticated using(false) with check(false);

drop policy if exists server_only on public.cm_team_members;
create policy server_only on public.cm_team_members for all to anon, authenticated using(false) with check(false);

drop policy if exists server_only on public.cm_team_products;
create policy server_only on public.cm_team_products for all to anon, authenticated using(false) with check(false);

drop policy if exists server_only on public.cm_commission_rules;
create policy server_only on public.cm_commission_rules for all to anon, authenticated using(false) with check(false);

commit;

