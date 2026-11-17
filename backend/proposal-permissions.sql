-- Mantém a validação existente e acrescenta o módulo Propostas.
-- Não altera os módulos atribuídos aos usuários.
alter table public.cm_profiles drop constraint cm_profiles_modules_check;
alter table public.cm_profiles add constraint cm_profiles_modules_check check (
 modules <@ array['Visão geral','Empresas','Demonstrações','Contratos','Recebíveis','Comissões','Produtos e regras','Metas','Propostas','Usuários e acessos']::text[]
);
