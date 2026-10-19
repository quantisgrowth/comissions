alter table public.cm_profiles drop constraint cm_profiles_role_check;
alter table public.cm_profiles add constraint cm_profiles_role_check check (role in ('Administrador','Gestor','Colaborador','Vendedor','Desenvolvedor'));
alter table public.cm_profiles add constraint cm_profiles_developer_company_check check (role <> 'Desenvolvedor' or (not all_companies and cardinality(companies)>0));
