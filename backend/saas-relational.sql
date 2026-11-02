-- ==============================================================================
-- SAAS MIGRATION: RELATIONAL CONTRACTS, INVOICES AND COMMISSIONS
-- Este script cria a estrutura relacional para suporte a alto volume e concorrência,
-- eliminando os limites de 4 MB e permitindo consultas diretas e isoladas por Tenant.
-- Execute no SQL Editor do Supabase após a execução do saas-tenants-teams.sql.
-- ==============================================================================

begin;

-- 1. Contratos e Vendas por Tenant
create table if not exists public.cm_contracts (
    id bigint primary key,
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    code text not null,
    sale_id uuid not null,
    company text not null check (company ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    client text not null check (char_length(client) between 1 and 200),
    product_id text not null check (product_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    team_id uuid references public.cm_teams(id),
    plan_name text not null,
    monthly numeric(12,2) not null default 0,
    setup numeric(12,2) not null default 0,
    setup_waived boolean not null default false,
    setup_parts integer not null default 1,
    seller_id uuid not null references public.cm_profiles(id),
    sdr_id uuid references public.cm_profiles(id),
    dev_id uuid references public.cm_profiles(id),
    partner_id uuid references public.cm_profiles(id),
    commission_payer uuid references public.cm_profiles(id),
    start_date date not null,
    first_due date not null,
    next_fee_due date,
    billing_day integer check (billing_day between 1 and 31),
    status text not null default 'Pendente' check (status in ('Pendente','Ativo','Cancelado')),
    review_status text not null default 'draft' check (review_status in ('draft','submitted','returned','approved')),
    portal_request_id text,
    review_history jsonb not null default '[]'::jsonb,
    rules_snapshot jsonb not null default '{}'::jsonb,
    archived boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(tenant_id, code)
);
create index if not exists cm_contracts_tenant_company_idx on public.cm_contracts(tenant_id, company, seller_id);
create index if not exists cm_contracts_portal_req_idx on public.cm_contracts(portal_request_id);

-- 2. Faturas e Recebíveis
create table if not exists public.cm_invoices (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    contract_id bigint not null references public.cm_contracts(id) on delete cascade,
    company text not null,
    kind text not null check (kind in ('fee','setup')),
    fee_number integer default 0,
    part_number integer default 0,
    amount numeric(12,2) not null,
    due_date date not null,
    paid_at date,
    reported_paid_at date,
    archived boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists cm_invoices_tenant_contract_idx on public.cm_invoices(tenant_id, contract_id, due_date);
create index if not exists cm_invoices_paid_at_idx on public.cm_invoices(tenant_id, company, paid_at);

-- 3. Comissões Calculadas e Histórico de Pagamentos
create table if not exists public.cm_commissions (
    id text primary key, -- ex: invoice_id + '-seller'
    tenant_id uuid not null references public.cm_tenants(id) on delete cascade,
    contract_id bigint not null references public.cm_contracts(id) on delete cascade,
    invoice_id uuid not null references public.cm_invoices(id) on delete cascade,
    beneficiary_id uuid not null references public.cm_profiles(id),
    role_key text not null,
    label text not null,
    rate numeric(5,2),
    amount numeric(12,2) not null,
    adjusted_amount numeric(12,2),
    paid_at date,
    scheduled_date date,
    competence text not null check (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    batch_id uuid,
    payer_id uuid references public.cm_profiles(id),
    payment_method text,
    released boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists cm_commissions_tenant_ben_idx on public.cm_commissions(tenant_id, beneficiary_id, competence);
create index if not exists cm_commissions_batch_idx on public.cm_commissions(tenant_id, batch_id);

-- 4. RLS e Políticas
alter table public.cm_contracts enable row level security;
alter table public.cm_invoices enable row level security;
alter table public.cm_commissions enable row level security;

revoke all on public.cm_contracts, public.cm_invoices, public.cm_commissions from anon, authenticated;
grant all on public.cm_contracts, public.cm_invoices, public.cm_commissions to service_role;

drop policy if exists server_only on public.cm_contracts;
create policy server_only on public.cm_contracts for all to anon, authenticated using(false) with check(false);

drop policy if exists server_only on public.cm_invoices;
create policy server_only on public.cm_invoices for all to anon, authenticated using(false) with check(false);

drop policy if exists server_only on public.cm_commissions;
create policy server_only on public.cm_commissions for all to anon, authenticated using(false) with check(false);

commit;

