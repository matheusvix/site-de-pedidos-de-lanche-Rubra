-- ============================================================
-- Rubra — banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro uma vez em: SQL Editor › New query
-- ============================================================

-- Leads vindos do site (teste grátis e "falar com especialista")
create table if not exists public.leads (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  tipo        text not null check (tipo in ('cadastro', 'consultor')),
  nome        text not null check (char_length(nome) between 1 and 120),
  loja        text not null check (char_length(loja) between 1 and 160),
  telefone    text check (char_length(telefone) <= 30),
  email       text check (char_length(email) <= 200),
  segmento    text check (char_length(segmento) <= 60),
  plano       text check (char_length(plano) <= 40),
  assunto     text check (char_length(assunto) <= 120),
  mensagem    text check (char_length(mensagem) <= 2000),
  status      text not null default 'novo'
              check (status in ('novo', 'em_contato', 'convertido', 'perdido')),
  notas       text check (char_length(notas) <= 4000),
  updated_at  timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

-- Quem é administrador (por e-mail da conta de login)
create table if not exists public.admins (
  email text primary key
);

insert into public.admins (email) values ('mvix.com@gmail.com')
on conflict (email) do nothing;

-- Função usada pelas regras: o usuário logado é admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Atualiza updated_at automaticamente
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Segurança (Row Level Security)
-- ------------------------------------------------------------
alter table public.leads  enable row level security;
alter table public.admins enable row level security;

-- Visitantes do site podem APENAS inserir leads novos (não leem nada)
drop policy if exists "site insere leads" on public.leads;
create policy "site insere leads" on public.leads
  for insert to anon, authenticated
  with check (status = 'novo' and notas is null);

-- Só admins leem, editam e apagam leads
drop policy if exists "admin le leads" on public.leads;
create policy "admin le leads" on public.leads
  for select to authenticated using (public.is_admin());

drop policy if exists "admin edita leads" on public.leads;
create policy "admin edita leads" on public.leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin apaga leads" on public.leads;
create policy "admin apaga leads" on public.leads
  for delete to authenticated using (public.is_admin());

-- Só admins enxergam a lista de admins
drop policy if exists "admin le admins" on public.admins;
create policy "admin le admins" on public.admins
  for select to authenticated using (public.is_admin());

-- Permissões básicas das tabelas
grant usage on schema public to anon, authenticated;
grant insert on public.leads to anon, authenticated;
grant select, update, delete on public.leads to authenticated;
grant select on public.admins to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ------------------------------------------------------------
-- Depoimentos de clientes (só aparecem no site depois de aprovados)
-- ------------------------------------------------------------
create table if not exists public.testimonials (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  nome        text not null check (char_length(nome) between 1 and 80),
  loja        text not null check (char_length(loja) between 1 and 120),
  cidade      text not null check (char_length(cidade) between 1 and 80),
  segmento    text not null check (char_length(segmento) between 1 and 40),
  texto       text not null check (char_length(texto) between 20 and 400),
  status      text not null default 'pendente' check (status in ('pendente', 'aprovado', 'oculto'))
);
create index if not exists testimonials_status_idx on public.testimonials (status, created_at desc);

alter table public.testimonials enable row level security;

-- Visitantes enviam depoimentos (sempre como pendentes)
drop policy if exists "site envia depoimento" on public.testimonials;
create policy "site envia depoimento" on public.testimonials
  for insert to anon, authenticated with check (status = 'pendente');

-- Qualquer visitante lê apenas os aprovados
drop policy if exists "site le aprovados" on public.testimonials;
create policy "site le aprovados" on public.testimonials
  for select to anon, authenticated using (status = 'aprovado' or public.is_admin());

-- Só admins aprovam, ocultam e apagam
drop policy if exists "admin edita depoimentos" on public.testimonials;
create policy "admin edita depoimentos" on public.testimonials
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin apaga depoimentos" on public.testimonials;
create policy "admin apaga depoimentos" on public.testimonials
  for delete to authenticated using (public.is_admin());

grant insert, select on public.testimonials to anon, authenticated;
grant update, delete on public.testimonials to authenticated;
