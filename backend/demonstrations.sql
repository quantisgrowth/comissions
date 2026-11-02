-- ==============================================================================
-- SAAS MIGRATION: GESTÃO DE DEMONSTRAÇÕES, LEADS, REMARCAÇÕES E COMISSÕES CRM
-- Tabelas relacionais com tipagem forte, índices e RLS seguro.
-- Execute no SQL Editor do Supabase.
-- ==============================================================================

begin;

-- 1. Tabela de Leads Comerciais
create table if not exists public.cm_leads (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.cm_tenants(id) on delete cascade,
    company_id text not null check (company_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    company_name text not null check (char_length(company_name) between 1 and 200),
    contact_name text,
    phone text,
    email text,
    segment text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists cm_leads_company_idx on public.cm_leads(tenant_id, company_id);
create index if not exists cm_leads_email_idx on public.cm_leads(email);
create index if not exists cm_leads_phone_idx on public.cm_leads(phone);

-- 2. Tabela de Demonstrações
create table if not exists public.cm_demonstrations (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.cm_tenants(id) on delete cascade,
    company_id text not null check (company_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    crm_deal_id text, -- Identificador único no CRM DataCrazy para idempotência
    lead_id uuid not null references public.cm_leads(id) on delete cascade,
    sdr_id uuid references public.cm_profiles(id) on delete set null,
    closer_id uuid references public.cm_profiles(id) on delete set null,
    product_id text,
    status text not null default 'agendado' check (status in ('agendado', 'aguardando_reagendamento', 'demo_follow_up', 'trial', 'realizado', 'fechado', 'perdido')),
    is_completed boolean not null default false,
    first_scheduled_date timestamptz not null,
    current_scheduled_date timestamptz not null,
    completed_date timestamptz,
    reschedule_count integer not null default 0,
    cycle_days integer,
    deal_value_mrr numeric(12,2) not null default 0,
    deal_value_setup numeric(12,2) not null default 0,
    loss_reason text,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists cm_demos_tenant_company_idx on public.cm_demonstrations(tenant_id, company_id);
create index if not exists cm_demos_crm_deal_idx on public.cm_demonstrations(tenant_id, company_id, crm_deal_id);
create index if not exists cm_demos_status_idx on public.cm_demonstrations(status);
create index if not exists cm_demos_dates_idx on public.cm_demonstrations(current_scheduled_date, first_scheduled_date);
create index if not exists cm_demos_sdr_closer_idx on public.cm_demonstrations(sdr_id, closer_id);

-- 3. Tabela de Logs de Remarcação (Histórico Completo)
create table if not exists public.cm_reschedule_logs (
    id uuid primary key default gen_random_uuid(),
    demonstration_id uuid not null references public.cm_demonstrations(id) on delete cascade,
    previous_date timestamptz not null,
    new_date timestamptz not null,
    reason text,
    actor_id uuid references public.cm_profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists cm_reschedule_demo_idx on public.cm_reschedule_logs(demonstration_id);

-- 4. Tabela de Comissões Comerciais de Demonstrações Fechadas
create table if not exists public.cm_sales_commissions (
    id uuid primary key default gen_random_uuid(),
    demonstration_id uuid not null references public.cm_demonstrations(id) on delete cascade unique,
    contract_id bigint, -- Vincula ao contrato gerado no sistema
    deal_value_mrr numeric(12,2) not null default 0,
    deal_value_setup numeric(12,2) not null default 0,
    closed_date timestamptz not null default now(),
    sdr_commission_amount numeric(12,2) not null default 0,
    closer_commission_amount numeric(12,2) not null default 0,
    status_payment text not null default 'pendente' check (status_payment in ('pendente', 'aprovado', 'pago', 'cancelado')),
    created_at timestamptz not null default now()
);

create index if not exists cm_sales_commissions_demo_idx on public.cm_sales_commissions(demonstration_id);

-- 5. Tabela de Logs de Webhooks Recebidos (Auditoria e Monitoramento em tempo real)
create table if not exists public.cm_webhook_logs (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.cm_tenants(id) on delete cascade,
    company_id text,
    event text not null,
    deal_id text,
    status_code integer not null default 200,
    status_text text not null default 'success',
    payload jsonb not null,
    response jsonb,
    error_message text,
    created_at timestamptz not null default now()
);

create index if not exists cm_webhook_logs_created_idx on public.cm_webhook_logs(created_at desc);
create index if not exists cm_webhook_logs_deal_idx on public.cm_webhook_logs(deal_id);

-- 6. Configuração de RLS e Permissões Seguras
alter table public.cm_leads enable row level security;
alter table public.cm_demonstrations enable row level security;
alter table public.cm_reschedule_logs enable row level security;
alter table public.cm_sales_commissions enable row level security;
alter table public.cm_webhook_logs enable row level security;

grant select, insert, update, delete on public.cm_leads, public.cm_demonstrations, public.cm_reschedule_logs, public.cm_sales_commissions, public.cm_webhook_logs to authenticated, service_role;

-- Políticas de RLS
drop policy if exists leads_auth on public.cm_leads;
create policy leads_auth on public.cm_leads for all to authenticated using (true) with check (true);

drop policy if exists demos_auth on public.cm_demonstrations;
create policy demos_auth on public.cm_demonstrations for all to authenticated using (true) with check (true);

drop policy if exists reschedule_auth on public.cm_reschedule_logs;
create policy reschedule_auth on public.cm_reschedule_logs for all to authenticated using (true) with check (true);

drop policy if exists sales_commissions_auth on public.cm_sales_commissions;
create policy sales_commissions_auth on public.cm_sales_commissions for all to authenticated using (true) with check (true);

drop policy if exists webhook_logs_auth on public.cm_webhook_logs;
create policy webhook_logs_auth on public.cm_webhook_logs for all to authenticated using (true) with check (true);

commit;

