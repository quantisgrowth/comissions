alter table public.cm_profiles drop constraint cm_profiles_role_check;
alter table public.cm_profiles add constraint cm_profiles_role_check check (role in ('Administrador','Gestor','Colaborador','Vendedor'));
alter table public.cm_profiles add column modules text[];
update public.cm_profiles set modules=case when role='Administrador' then array['Visão geral','Empresas','Contratos','Recebíveis','Comissões','Produtos e regras','Metas','Usuários e acessos'] when role='Gestor' then array['Visão geral','Empresas','Contratos','Recebíveis','Comissões','Produtos e regras','Metas'] else array['Comissões'] end;
alter table public.cm_profiles alter column modules set default array['Comissões'];
alter table public.cm_profiles alter column modules set not null;
alter table public.cm_profiles add constraint cm_profiles_modules_check check (modules <@ array['Visão geral','Empresas','Contratos','Recebíveis','Comissões','Produtos e regras','Metas','Usuários e acessos']::text[]);
alter table public.cm_profiles add constraint cm_profiles_seller_company_check check (role <> 'Vendedor' or (not all_companies and cardinality(companies)>0));
