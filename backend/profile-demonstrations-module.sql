alter table public.cm_profiles
  drop constraint cm_profiles_modules_check,
  add constraint cm_profiles_modules_check
  check (modules <@ array['Visão geral','Empresas','Demonstrações','Contratos','Recebíveis','Comissões','Produtos e regras','Metas','Usuários e acessos']::text[]);
