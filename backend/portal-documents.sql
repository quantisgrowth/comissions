-- Execute uma vez no SQL Editor do projeto Supabase conectado ao Comissions.
-- Não altera cadastros, contratos, comissões ou permissões de usuários existentes.
begin;
create table if not exists public.cm_documents (
 id uuid primary key default gen_random_uuid(),
 company text not null check (company ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
 sale_id text not null check (sale_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
 uploaded_by uuid not null references public.cm_profiles(id),
 object_path text not null unique,
 name text not null check (char_length(name) between 1 and 180),
 content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png')),
 size_bytes integer not null check (size_bytes between 1 and 10485760),
 status text not null default 'pending' check (status in ('pending','ready','rejected','archived')),
 created_at timestamptz not null default now()
);
create index if not exists cm_documents_sale on public.cm_documents(company,sale_id,created_at);
create index if not exists cm_documents_uploader on public.cm_documents(uploaded_by);
alter table public.cm_documents enable row level security;
revoke all on public.cm_documents from anon, authenticated;
grant all on public.cm_documents to service_role;
drop policy if exists server_only on public.cm_documents;
create policy server_only on public.cm_documents for all to anon, authenticated using(false) with check(false);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('sale-documents','sale-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
commit;
-- Nenhuma política pública em storage.objects: a função autenticada autoriza
-- cada venda e emite URLs temporárias. Não torne este bucket público.
