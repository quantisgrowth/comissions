-- Catálogo e propostas independentes por empresa; acesso somente pela API autenticada.
create table if not exists public.cm_proposal_catalog (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.cm_tenants(id),
 company text not null, kind text not null check(kind in ('plan','module','brand')),
 data jsonb not null default '{}'::jsonb, version integer not null default 1,
 created_by uuid not null references public.cm_profiles(id), updated_at timestamptz not null default now()
);
create index if not exists cm_proposal_catalog_scope on public.cm_proposal_catalog(tenant_id,company);
create unique index if not exists cm_proposal_brand_unique on public.cm_proposal_catalog(tenant_id,company) where kind='brand';
create table if not exists public.cm_proposals (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.cm_tenants(id),
 company text not null, created_by uuid not null references public.cm_profiles(id),
 data jsonb not null, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists cm_proposals_scope on public.cm_proposals(tenant_id,company,created_by,updated_at desc);
alter table public.cm_proposal_catalog enable row level security;
alter table public.cm_proposals enable row level security;
revoke all on public.cm_proposal_catalog,public.cm_proposals from public,anon,authenticated;
grant select,insert,update,delete on public.cm_proposal_catalog,public.cm_proposals to service_role;

create unique index if not exists cm_proposal_catalog_name_unique on public.cm_proposal_catalog(tenant_id,company,kind,(lower(data->>'name'))) where kind in ('plan','module');

-- Referência pública dos PDFs; sem preços negociados ou dados de clientes.
insert into public.cm_proposal_catalog(tenant_id,company,kind,data,created_by)
select p.tenant_id,'quantis',v.kind,v.data,p.id
from (select id,coalesce(tenant_id,'00000000-0000-0000-0000-000000000001'::uuid) tenant_id from public.cm_profiles where role='Administrador' and active and coalesce(tenant_id,'00000000-0000-0000-0000-000000000001'::uuid)='00000000-0000-0000-0000-000000000001' order by created_at limit 1) p
cross join jsonb_to_recordset($seed$[{"kind":"plan","data":{"name":"Lift Start","kind":"plan","cadence":"monthly","price":397,"setup":null,"description":"Para operações pequenas e em início de organização.","features":"Até 2 usuários\nAté 5 veículos ou máquinas\nMotoristas ilimitados\nRecursos essenciais","unit":"unidade","usage":"","archived":false}},{"kind":"plan","data":{"name":"Lift Pro","kind":"plan","cadence":"monthly","price":697,"setup":null,"description":"Para equipes em crescimento e com mais ativos.","features":"Até 5 usuários\nAté 20 veículos ou máquinas\nMotoristas ilimitados\nRecursos essenciais","unit":"unidade","usage":"","archived":false}},{"kind":"plan","data":{"name":"Lift Unlimited","kind":"plan","cadence":"monthly","price":1297,"setup":null,"description":"Para operações consolidadas.","features":"Usuários ilimitados*\nVeículos e máquinas ilimitados*\nMotoristas ilimitados","unit":"unidade","usage":"* Sujeito à política de uso adequado, a ser detalhada na contratação.","archived":false}},{"kind":"module","data":{"name":"Usuário adicional","kind":"module","cadence":"monthly","price":19.9,"setup":null,"description":"","features":"Acesso de um usuário adicional","unit":"usuário","usage":"","archived":false}},{"kind":"module","data":{"name":"Módulo NFS-e","kind":"module","cadence":"monthly","price":149,"setup":null,"description":"","features":"Módulo fiscal NFS-e","unit":"unidade","usage":"","archived":false}},{"kind":"brand","data":{"name":"Quantis Lift","color":"#15bfc7","logo":"","cover":"https://quantisgrowth.github.io/comissions/assets/quantis-cover.jpg","headline":"Gestão operacional e financeira para empresas que vivem da frota","subtitle":"Da abertura da ordem de serviço ao custo por veículo, com a informação no mesmo fluxo.","email":"comercial@quantislift.com.br","phone":"","website":"quantislift.com.br","benefits":"Menos retrabalho | OS, agenda e responsável no mesmo registro.\nMais controle | Pendências operacionais e financeiras no mesmo fluxo.\nResultado por veículo | Entenda onde os custos e o faturamento se formam.","resources":"Ordens de serviço | Agenda, abertura, execução, assinatura e histórico.\nFinanceiro | Contas a receber, pagamentos, despesas e investimentos.\nFrota | Veículos, leituras, manutenção, combustível e movimentações.\nFiscal | Configuração e rascunhos de NFS-e, conforme o módulo contratado.\nClientes e equipe | Cadastros, perfis e permissões.\nRelatórios | Visões gerenciais e acompanhamento do resultado.","implementation":"Diagnóstico | Alinhamento de processos, usuários e prioridades.\nConfiguração | Preparação do ambiente e dos dados iniciais.\nTreinamento | Orientação da equipe nos principais fluxos.\nEntrada em operação | Acompanhamento inicial e ajustes de uso.","terms":"O início da cobrança e o vencimento serão definidos na contratação.\nIntegrações, migrações, treinamentos adicionais e personalizações somente quando expressamente incluídos.\nO cronograma depende do escopo, dos dados e da disponibilidade da equipe do cliente.\nCondições de fidelidade, aviso prévio e eventual multa serão detalhadas no contrato.","closing":"Escolha a condição comercial e fale com o responsável pela proposta para confirmar o escopo e iniciar a contratação."}}]$seed$::jsonb) as v(kind text,data jsonb)
where exists(select 1 from public.cm_state s,jsonb_array_elements(s.data->'companies') c where s.id=1 and c->>'id'='quantis')
on conflict do nothing;
