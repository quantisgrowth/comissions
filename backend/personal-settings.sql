begin;
create table if not exists public.cm_job_titles (
 id uuid primary key default gen_random_uuid(), name text not null unique check(char_length(name) between 2 and 100),
 active boolean not null default true, created_by uuid references public.cm_profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.cm_personal_profiles (
 profile_id uuid primary key references public.cm_profiles(id), full_name text, cpf text, contact_email text, phone text,
 bank_name text, bank_agency text, bank_account text, bank_holder text, pix_key text,
 job_title_id uuid references public.cm_job_titles(id), avatar_path text, pending_avatar_path text,
 pending_avatar_type text, pending_avatar_size integer, updated_at timestamptz not null default now()
);
create index if not exists cm_personal_job_title on public.cm_personal_profiles(job_title_id);
alter table public.cm_job_titles enable row level security;
alter table public.cm_personal_profiles enable row level security;
revoke all on public.cm_job_titles, public.cm_personal_profiles from anon, authenticated;
grant all on public.cm_job_titles, public.cm_personal_profiles to service_role;
create or replace function public.cm_update_personal_profile(person_id uuid, fields jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
 insert into public.cm_personal_profiles(profile_id,full_name,cpf,contact_email,phone,job_title_id,bank_name,bank_agency,bank_account,bank_holder,pix_key)
 values(person_id,fields->>'full_name',fields->>'cpf',fields->>'contact_email',fields->>'phone',nullif(fields->>'job_title_id','')::uuid,fields->>'bank_name',fields->>'bank_agency',fields->>'bank_account',fields->>'bank_holder',fields->>'pix_key')
 on conflict(profile_id) do update set full_name=excluded.full_name,cpf=excluded.cpf,contact_email=excluded.contact_email,phone=excluded.phone,job_title_id=excluded.job_title_id,bank_name=excluded.bank_name,bank_agency=excluded.bank_agency,bank_account=excluded.bank_account,bank_holder=excluded.bank_holder,pix_key=excluded.pix_key,updated_at=now();
 update public.cm_profiles set name=fields->>'full_name' where id=person_id;
end; $$;
revoke all on function public.cm_update_personal_profile(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.cm_update_personal_profile(uuid,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,2097152,array['image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
commit;
