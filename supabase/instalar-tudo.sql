-- BoraLanchar! — instalação completa (cole tudo no SQL Editor do Supabase e clique em Run)

-- ============================================================
-- BoraLanchar! — banco de dados (Supabase / Postgres)
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

-- ============================================================
-- BoraLanchar! — sistema dos restaurantes
-- (rode depois de schema.sql)
-- Restaurantes, cardápio (categorias e produtos), pedidos,
-- funções seguras para criar a loja e fazer pedidos, e fotos.
-- ============================================================

-- ------------------------------------------------------------
-- Restaurantes (cada conta de cliente tem um)
-- ------------------------------------------------------------
create table if not exists public.restaurants (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name             text not null check (char_length(name) between 2 and 80),
  segment          text check (char_length(segment) <= 60),
  whatsapp         text check (whatsapp ~ '^[0-9]{10,13}$'),
  address          text check (char_length(address) <= 200),
  hours            text check (char_length(hours) <= 120),
  delivery_time    text not null default '30–45 min' check (char_length(delivery_time) <= 30),
  delivery_fee     numeric(8,2) not null default 0 check (delivery_fee >= 0 and delivery_fee < 1000),
  min_order        numeric(8,2) not null default 0 check (min_order >= 0 and min_order < 10000),
  accepts_delivery boolean not null default true,
  accepts_pickup   boolean not null default true,
  is_open          boolean not null default true,
  plan             text not null default 'Profissional' check (plan in ('Essencial', 'Profissional', 'Completo')),
  status           text not null default 'teste' check (status in ('teste', 'ativo', 'suspenso')),
  trial_ends_at    timestamptz not null default now() + interval '7 days',
  created_at       timestamptz not null default now()
);
create unique index if not exists restaurants_owner_uidx on public.restaurants (owner_id);

-- O restaurante pode receber pedidos? (teste dentro do prazo ou plano ativo)
create or replace function public.restaurant_can_sell(r public.restaurants)
returns boolean language sql stable set search_path = public as $$
  select r.status = 'ativo' or (r.status = 'teste' and r.trial_ends_at > now());
$$;

-- O usuário logado é dono deste restaurante?
create or replace function public.owns_restaurant(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = auth.uid());
$$;

-- Dono não altera plano, status, fim do teste nem dono (só o admin)
create or replace function public.restaurants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.plan := old.plan;
    new.status := old.status;
    new.trial_ends_at := old.trial_ends_at;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
drop trigger if exists restaurants_guard on public.restaurants;
create trigger restaurants_guard before update on public.restaurants
for each row execute function public.restaurants_guard();

-- ------------------------------------------------------------
-- Cardápio
-- ------------------------------------------------------------
create table if not exists public.categories (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  position      int not null default 0
);
create index if not exists categories_rest_idx on public.categories (restaurant_id, position);

create table if not exists public.products (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id   bigint references public.categories (id) on delete set null,
  name          text not null check (char_length(name) between 1 and 80),
  description   text check (char_length(description) <= 300),
  price         numeric(8,2) not null check (price >= 0 and price < 10000),
  image_url     text check (char_length(image_url) <= 500),
  available     boolean not null default true,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists products_rest_idx on public.products (restaurant_id, category_id, position);

-- ------------------------------------------------------------
-- Pedidos (só entram pela função place_order)
-- ------------------------------------------------------------
create table if not exists public.orders (
  id             bigint generated always as identity primary key,
  public_id      uuid not null unique default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  number         int not null,
  customer_name  text not null check (char_length(customer_name) between 1 and 80),
  customer_phone text not null check (char_length(customer_phone) between 8 and 20),
  mode           text not null check (mode in ('entrega', 'retirada')),
  address        text check (char_length(address) <= 300),
  payment        text not null check (payment in ('pix', 'cartao', 'dinheiro')),
  change_for     numeric(8,2),
  notes          text check (char_length(notes) <= 300),
  items          jsonb not null,
  subtotal       numeric(10,2) not null,
  fee            numeric(8,2) not null default 0,
  total          numeric(10,2) not null,
  status         text not null default 'novo' check (status in ('novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado')),
  created_at     timestamptz not null default now()
);
create index if not exists orders_rest_idx on public.orders (restaurant_id, created_at desc);

-- ------------------------------------------------------------
-- Segurança (RLS)
-- ------------------------------------------------------------
alter table public.restaurants enable row level security;
alter table public.categories  enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;

-- Restaurantes: o cardápio público precisa ler; dono e admin editam
drop policy if exists "publico le restaurantes" on public.restaurants;
create policy "publico le restaurantes" on public.restaurants for select to anon, authenticated using (true);
drop policy if exists "dono edita restaurante" on public.restaurants;
create policy "dono edita restaurante" on public.restaurants for update to authenticated
  using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "admin apaga restaurante" on public.restaurants;
create policy "admin apaga restaurante" on public.restaurants for delete to authenticated using (public.is_admin());

-- Categorias e produtos: leitura pública; escrita só do dono (ou admin)
drop policy if exists "publico le categorias" on public.categories;
create policy "publico le categorias" on public.categories for select to anon, authenticated using (true);
drop policy if exists "dono gerencia categorias" on public.categories;
create policy "dono gerencia categorias" on public.categories for all to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin())
  with check (public.owns_restaurant(restaurant_id) or public.is_admin());

drop policy if exists "publico le produtos" on public.products;
create policy "publico le produtos" on public.products for select to anon, authenticated using (true);
drop policy if exists "dono gerencia produtos" on public.products;
create policy "dono gerencia produtos" on public.products for all to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin())
  with check (public.owns_restaurant(restaurant_id) or public.is_admin());

-- Pedidos: só o dono (e o admin) vê e muda o status
drop policy if exists "dono le pedidos" on public.orders;
create policy "dono le pedidos" on public.orders for select to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin());
drop policy if exists "dono atualiza pedidos" on public.orders;
create policy "dono atualiza pedidos" on public.orders for update to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin())
  with check (public.owns_restaurant(restaurant_id) or public.is_admin());

grant select on public.restaurants, public.categories, public.products to anon, authenticated;
grant update, delete on public.restaurants to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant select, update on public.orders to authenticated;

-- ------------------------------------------------------------
-- Funções
-- ------------------------------------------------------------

-- Cria o restaurante do usuário logado (com link único e categorias iniciais)
create or replace function public.create_my_restaurant(p_name text, p_whatsapp text, p_segment text, p_plan text)
returns public.restaurants
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  base text;
  cand text;
  n int := 1;
  r public.restaurants;
begin
  if uid is null then raise exception 'login necessário'; end if;
  select * into r from public.restaurants where owner_id = uid;
  if found then return r; end if;
  base := lower(regexp_replace(translate(coalesce(p_name, 'loja'),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'), '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from left(base, 34));
  if char_length(base) < 3 then base := 'loja-' || substr(md5(uid::text), 1, 5); end if;
  cand := base;
  while exists (select 1 from public.restaurants where slug = cand) loop
    n := n + 1; cand := base || '-' || n;
  end loop;
  insert into public.restaurants (owner_id, slug, name, whatsapp, segment, plan)
  values (uid, cand, left(trim(p_name), 80),
          nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), ''),
          left(p_segment, 60),
          case when p_plan in ('Essencial', 'Profissional', 'Completo') then p_plan else 'Profissional' end)
  returning * into r;
  insert into public.categories (restaurant_id, name, position)
  values (r.id, 'Lanches', 1), (r.id, 'Porções', 2), (r.id, 'Bebidas', 3);
  return r;
end;
$$;

-- Faz um pedido: preços sempre calculados no servidor
create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  it jsonb;
  p public.products;
  qty int;
  lines jsonb := '[]'::jsonb;
  sub numeric(10,2) := 0;
  fee numeric(8,2) := 0;
  m text := coalesce(p_customer ->> 'mode', 'entrega');
  num int;
  o public.orders;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.restaurant_can_sell(r) then raise exception 'Esta loja não está recebendo pedidos no momento'; end if;
  if not r.is_open then raise exception 'A loja está fechada agora'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'Sacola vazia ou inválida';
  end if;
  if m = 'entrega' and not r.accepts_delivery then raise exception 'Esta loja não faz entrega'; end if;
  if m = 'retirada' and not r.accepts_pickup then raise exception 'Esta loja não aceita retirada'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    qty := greatest(1, least(50, coalesce((it ->> 'qty')::int, 1)));
    select * into p from public.products where id = (it ->> 'product_id')::bigint and restaurant_id = r.id and available;
    if not found then raise exception 'Um item da sacola não está mais disponível'; end if;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'qty', qty, 'price', p.price,
      'note', left(coalesce(it ->> 'note', ''), 140));
    sub := sub + p.price * qty;
  end loop;

  if sub < r.min_order then raise exception 'Pedido mínimo: R$ %', to_char(r.min_order, 'FM999990D00'); end if;
  if m = 'entrega' then fee := r.delivery_fee; end if;

  perform pg_advisory_xact_lock(hashtext(r.id::text));
  select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = r.id;

  insert into public.orders (restaurant_id, number, customer_name, customer_phone, mode, address, payment, change_for, notes, items, subtotal, fee, total)
  values (r.id, num,
          left(trim(p_customer ->> 'name'), 80),
          left(regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9()+ -]', '', 'g'), 20),
          m,
          case when m = 'entrega' then left(p_customer ->> 'address', 300) end,
          coalesce(p_customer ->> 'payment', 'pix'),
          nullif(p_customer ->> 'change_for', '')::numeric,
          left(p_customer ->> 'notes', 300),
          lines, sub, fee, sub + fee)
  returning * into o;

  return jsonb_build_object('public_id', o.public_id, 'number', o.number, 'total', o.total, 'subtotal', o.subtotal,
    'fee', o.fee, 'items', o.items, 'whatsapp', r.whatsapp, 'restaurant', r.name);
end;
$$;

-- Acompanhamento do pedido pelo cliente (só com o código secreto do pedido)
create or replace function public.order_status(p_public_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                            'restaurant', r.name, 'whatsapp', r.whatsapp)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.public_id = p_public_id;
$$;

revoke all on function public.create_my_restaurant(text, text, text, text) from public, anon;
grant execute on function public.create_my_restaurant(text, text, text, text) to authenticated;
grant execute on function public.place_order(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.order_status(uuid) to anon, authenticated;
grant execute on function public.restaurant_can_sell(public.restaurants) to anon, authenticated;
grant execute on function public.owns_restaurant(uuid) to authenticated;
revoke execute on function public.owns_restaurant(uuid) from public, anon;
revoke execute on function public.restaurants_guard() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Pedidos novos aparecem no painel na hora (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- Fotos dos produtos (Storage)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "dono envia fotos" on storage.objects;
create policy "dono envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and public.owns_restaurant(((storage.foldername(name))[1])::uuid));
drop policy if exists "dono troca fotos" on storage.objects;
create policy "dono troca fotos" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and public.owns_restaurant(((storage.foldername(name))[1])::uuid));
drop policy if exists "dono apaga fotos" on storage.objects;
create policy "dono apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and public.owns_restaurant(((storage.foldername(name))[1])::uuid));

-- ===================== loja-v2.sql =====================
-- ============================================================
-- BoraLanchar! — atualização "Minha loja" (rode depois de restaurantes.sql)
-- • Foto de perfil e capa, descrição, contatos (modelo Google Meu Negócio)
-- • Horário de funcionamento por dia da semana (vários turnos)
-- • Taxa e prazo de entrega por bairro ou por distância
-- • Opções clicáveis nos produtos (tirar, adicionar, escolher)
-- • O link da loja acompanha o nome (links antigos continuam funcionando)
-- ============================================================

alter table public.restaurants
  add column if not exists logo_url        text check (char_length(logo_url) <= 500),
  add column if not exists cover_url       text check (char_length(cover_url) <= 500),
  add column if not exists description     text check (char_length(description) <= 750),
  add column if not exists phone           text check (char_length(phone) <= 20),
  add column if not exists instagram       text check (char_length(instagram) <= 60),
  add column if not exists website         text check (char_length(website) <= 200),
  add column if not exists opening_hours   jsonb,
  add column if not exists delivery_mode   text not null default 'fixa',
  add column if not exists delivery_zones  jsonb not null default '[]'::jsonb,
  add column if not exists lat             double precision check (lat between -90 and 90),
  add column if not exists lng             double precision check (lng between -180 and 180),
  add column if not exists payment_methods text[] not null default array['pix', 'cartao', 'dinheiro'],
  add column if not exists pix_key         text check (char_length(pix_key) <= 120),
  add column if not exists old_slugs       text[] not null default '{}';

do $$ begin
  alter table public.restaurants add constraint restaurants_delivery_mode_chk check (delivery_mode in ('fixa', 'bairro', 'distancia'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.restaurants add constraint restaurants_zones_chk check (jsonb_typeof(delivery_zones) = 'array' and jsonb_array_length(delivery_zones) <= 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.restaurants add constraint restaurants_hours_chk check (opening_hours is null or jsonb_typeof(opening_hours) = 'object');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.restaurants add constraint restaurants_pay_chk check (payment_methods <@ array['pix', 'cartao', 'dinheiro'] and cardinality(payment_methods) >= 1);
exception when duplicate_object then null; end $$;
create index if not exists restaurants_old_slugs_idx on public.restaurants using gin (old_slugs);

alter table public.products add column if not exists options jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.products add constraint products_options_chk check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 12 and pg_column_size(options) < 20000);
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists delivery_info text check (char_length(delivery_info) <= 120),
  add column if not exists geo           text check (char_length(geo) <= 40);

-- ------------------------------------------------------------
-- Link da loja a partir do nome
-- ------------------------------------------------------------
create or replace function public.slugify(t text)
returns text language sql immutable set search_path = public as $$
  select trim(both '-' from left(lower(regexp_replace(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^a-zA-Z0-9]+', '-', 'g')), 34));
$$;

create or replace function public.unique_slug(base text, rid uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare cand text; n int := 1;
begin
  base := public.slugify(base);
  if char_length(base) < 3 then base := 'loja-' || substr(md5(coalesce(rid::text, random()::text)), 1, 5); end if;
  cand := base;
  while exists (select 1 from public.restaurants where slug = cand and id is distinct from rid) loop
    n := n + 1; cand := base || '-' || n;
  end loop;
  return cand;
end;
$$;

-- ------------------------------------------------------------
-- Proteções e ajustes automáticos ao salvar a loja
-- ------------------------------------------------------------
create or replace function public.restaurants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; iv jsonb;
begin
  if not public.is_admin() then
    new.plan := old.plan;
    new.status := old.status;
    new.trial_ends_at := old.trial_ends_at;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  end if;
  -- nome mudou e o link não foi editado à mão: o link acompanha o nome
  if new.name is distinct from old.name and new.slug = old.slug then
    new.slug := public.unique_slug(new.name, old.id);
  end if;
  new.slug := lower(new.slug);
  if new.slug <> old.slug then
    if exists (select 1 from public.restaurants where slug = new.slug and id <> old.id) then
      raise exception 'Este link já está em uso por outra loja';
    end if;
    new.old_slugs := (array_remove(old.old_slugs, new.slug) || old.slug)[greatest(1, cardinality(old.old_slugs) - 8):];
  end if;
  -- horários: {"0":[["18:00","23:30"]], ...} (0 = domingo)
  if new.opening_hours is not null then
    for k, iv in select key, value from jsonb_each(new.opening_hours) loop
      if k !~ '^[0-6]$' or jsonb_typeof(iv) <> 'array' then raise exception 'Horário inválido'; end if;
      perform (x ->> 0)::time, (x ->> 1)::time from jsonb_array_elements(iv) x;
    end loop;
  end if;
  return new;
end;
$$;

-- A loja está aberta agora? (chave liga/desliga + horário, no fuso de Brasília)
create or replace function public.store_open_now(r public.restaurants)
returns boolean language plpgsql stable set search_path = public as $$
declare
  lt timestamp := now() at time zone 'America/Sao_Paulo';
  d int := extract(dow from lt)::int;
  t time := lt::time;
  iv jsonb; s time; e time;
begin
  if not r.is_open then return false; end if;
  if r.opening_hours is null then return true; end if;
  for iv in select * from jsonb_array_elements(coalesce(r.opening_hours -> d::text, '[]')) loop
    s := (iv ->> 0)::time; e := (iv ->> 1)::time;
    if e > s then
      if t >= s and t < e then return true; end if;
    elsif t >= s then return true;              -- turno que passa da meia-noite
    end if;
  end loop;
  for iv in select * from jsonb_array_elements(coalesce(r.opening_hours -> ((d + 6) % 7)::text, '[]')) loop
    s := (iv ->> 0)::time; e := (iv ->> 1)::time;
    if e <= s and t < e then return true; end if; -- continuação do turno de ontem
  end loop;
  return false;
end;
$$;

create or replace function public.create_my_restaurant(p_name text, p_whatsapp text, p_segment text, p_plan text)
returns public.restaurants
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.restaurants;
begin
  if uid is null then raise exception 'login necessário'; end if;
  select * into r from public.restaurants where owner_id = uid;
  if found then return r; end if;
  insert into public.restaurants (owner_id, slug, name, whatsapp, segment, plan)
  values (uid, public.unique_slug(p_name, null), left(trim(p_name), 80),
          nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), ''),
          left(p_segment, 60),
          case when p_plan in ('Essencial', 'Profissional', 'Completo') then p_plan else 'Profissional' end)
  returning * into r;
  insert into public.categories (restaurant_id, name, position)
  values (r.id, 'Lanches', 1), (r.id, 'Porções', 2), (r.id, 'Bebidas', 3);
  return r;
end;
$$;

-- ------------------------------------------------------------
-- Pedido: preço (com opções) e taxa calculados no servidor
-- ------------------------------------------------------------
create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  it jsonb; p public.products; g jsonb; o jsonb; sel jsonb; z jsonb;
  qty int; cnt int; unit numeric(10,2);
  opts jsonb;
  lines jsonb := '[]'::jsonb;
  sub numeric(10,2) := 0;
  fee numeric(8,2) := 0;
  info text := null; geo text := null;
  m text := coalesce(p_customer ->> 'mode', 'entrega');
  pay text := coalesce(p_customer ->> 'payment', 'pix');
  clat float8; clng float8; dist float8;
  num int;
  ord public.orders;
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.restaurant_can_sell(r) then raise exception 'Esta loja não está recebendo pedidos no momento'; end if;
  if not public.store_open_now(r) then raise exception 'A loja está fechada agora'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'Sacola vazia ou inválida';
  end if;
  if m not in ('entrega', 'retirada') then raise exception 'Escolha entrega ou retirada'; end if;
  if m = 'entrega' and not r.accepts_delivery then raise exception 'Esta loja não faz entrega'; end if;
  if m = 'retirada' and not r.accepts_pickup then raise exception 'Esta loja não aceita retirada'; end if;
  if not (pay = any (r.payment_methods)) then raise exception 'Forma de pagamento não aceita por esta loja'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    qty := greatest(1, least(50, coalesce((it ->> 'qty')::int, 1)));
    select * into p from public.products where id = (it ->> 'product_id')::bigint and restaurant_id = r.id and available;
    if not found then raise exception 'Um item da sacola não está mais disponível'; end if;
    sel := coalesce(it -> 'options', '[]'::jsonb);
    if jsonb_typeof(sel) <> 'array' then sel := '[]'::jsonb; end if;
    unit := p.price; opts := '[]'::jsonb;
    for g in select * from jsonb_array_elements(p.options) loop
      cnt := 0;
      for o in select * from jsonb_array_elements(coalesce(g -> 'items', '[]'::jsonb)) loop
        if sel ? (o ->> 'id') then
          cnt := cnt + 1;
          if g ->> 'kind' <> 'remove' then unit := unit + greatest(0, coalesce((o ->> 'price')::numeric, 0)); end if;
          opts := opts || to_jsonb(case g ->> 'kind' when 'remove' then 'Sem ' || (o ->> 'name')
                                                      when 'add' then '+ ' || (o ->> 'name')
                                                      else (g ->> 'title') || ': ' || (o ->> 'name') end);
        end if;
      end loop;
      if g ->> 'kind' = 'choose' and cnt <> 1 then
        raise exception 'Escolha uma opção em "%" (%)', g ->> 'title', p.name;
      end if;
      if nullif(g ->> 'max', '') is not null and cnt > (g ->> 'max')::int then
        raise exception 'Escolha no máximo % em "%" (%)', g ->> 'max', g ->> 'title', p.name;
      end if;
    end loop;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'qty', qty, 'price', unit,
      'opts', opts, 'note', left(coalesce(it ->> 'note', ''), 140));
    sub := sub + unit * qty;
  end loop;

  if sub < r.min_order then raise exception 'Pedido mínimo: R$ %', to_char(r.min_order, 'FM999990D00'); end if;

  if m = 'entrega' then
    if r.delivery_mode = 'bairro' and jsonb_array_length(r.delivery_zones) > 0 then
      select x into z from jsonb_array_elements(r.delivery_zones) x
       where lower(trim(x ->> 'name')) = lower(trim(coalesce(p_customer ->> 'zone', ''))) limit 1;
      if z is null then raise exception 'Escolha um bairro atendido pela loja'; end if;
      fee := coalesce((z ->> 'fee')::numeric, 0);
      info := left('Bairro ' || (z ->> 'name') || coalesce(' · ' || nullif(z ->> 'time', ''), ''), 120);
    elsif r.delivery_mode = 'distancia' and jsonb_array_length(r.delivery_zones) > 0 then
      if r.lat is not null and coalesce(p_customer ->> 'lat', '') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
         and coalesce(p_customer ->> 'lng', '') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
        clat := (p_customer ->> 'lat')::float8; clng := (p_customer ->> 'lng')::float8;
        geo := round(clat::numeric, 6) || ',' || round(clng::numeric, 6);
        -- distância aproximada de rua: linha reta × 1,3
        dist := 1.3 * 2 * 6371 * asin(sqrt(power(sin(radians(clat - r.lat) / 2), 2)
                + cos(radians(r.lat)) * cos(radians(clat)) * power(sin(radians(clng - r.lng) / 2), 2)));
        select x into z from jsonb_array_elements(r.delivery_zones) x
         where (x ->> 'km')::numeric >= dist order by (x ->> 'km')::numeric limit 1;
        if z is null then raise exception 'Seu endereço está fora da área de entrega (cerca de % km)', round(dist::numeric, 1); end if;
        info := left(round(dist::numeric, 1) || ' km' || coalesce(' · ' || nullif(z ->> 'time', ''), ''), 120);
      else
        select x into z from jsonb_array_elements(r.delivery_zones) x order by (x ->> 'fee')::numeric desc limit 1;
        info := left('Distância não informada · taxa máxima' || coalesce(' · ' || nullif(z ->> 'time', ''), ''), 120);
      end if;
      fee := coalesce((z ->> 'fee')::numeric, 0);
    else
      fee := r.delivery_fee;
      info := left(r.delivery_time, 120);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(r.id::text));
  select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = r.id;

  insert into public.orders (restaurant_id, number, customer_name, customer_phone, mode, address, payment, change_for, notes,
                             items, subtotal, fee, total, delivery_info, geo)
  values (r.id, num,
          left(trim(p_customer ->> 'name'), 80),
          left(regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9()+ -]', '', 'g'), 20),
          m,
          case when m = 'entrega' then left(p_customer ->> 'address', 300) end,
          pay,
          nullif(p_customer ->> 'change_for', '')::numeric,
          left(p_customer ->> 'notes', 300),
          lines, sub, fee, sub + fee, info, geo)
  returning * into ord;

  return jsonb_build_object('public_id', ord.public_id, 'number', ord.number, 'total', ord.total, 'subtotal', ord.subtotal,
    'fee', ord.fee, 'items', ord.items, 'whatsapp', r.whatsapp, 'restaurant', r.name,
    'delivery_info', ord.delivery_info, 'pix_key', r.pix_key);
end;
$$;

grant execute on function public.store_open_now(public.restaurants) to anon, authenticated;
grant execute on function public.slugify(text) to anon, authenticated;
revoke execute on function public.unique_slug(text, uuid) from public, anon;
grant execute on function public.unique_slug(text, uuid) to authenticated;
revoke execute on function public.restaurants_guard() from public, anon, authenticated;

-- Links já existentes passam a seguir o nome atual da loja
update public.restaurants r set slug = public.unique_slug(r.name, r.id)
 where r.slug not like public.slugify(r.name) || '%';

-- ===================== pix.sql =====================
-- BoraLanchar! — Pix com QR Code e copia e cola (rode depois de loja-v2.sql)
alter table public.restaurants
  add column if not exists pix_key_type text,
  add column if not exists pix_name     text check (char_length(pix_name) <= 25),
  add column if not exists pix_city     text check (char_length(pix_city) <= 15),
  add column if not exists pix_bank     text check (char_length(pix_bank) <= 40);
do $$ begin
  alter table public.restaurants add constraint restaurants_pix_type_chk check (pix_key_type is null or pix_key_type in ('cpf','cnpj','celular','email','aleatoria'));
exception when duplicate_object then null; end $$;
alter table public.orders add column if not exists paid boolean not null default false;

create or replace function public.order_status(p_public_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                            'paid', o.paid, 'restaurant', r.name, 'whatsapp', r.whatsapp)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.public_id = p_public_id;
$$;

-- ===================== pix-fluxo.sql =====================
-- BoraLanchar! — Pix: pagar primeiro, pedido vai para a loja depois (rode depois de pix.sql)
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pagamento', 'novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'));
alter table public.orders add column if not exists pix_informed_at timestamptz;

create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  it jsonb; p public.products; g jsonb; o jsonb; sel jsonb; z jsonb;
  qty int; cnt int; unit numeric(10,2);
  opts jsonb;
  lines jsonb := '[]'::jsonb;
  sub numeric(10,2) := 0;
  fee numeric(8,2) := 0;
  info text := null; geo text := null;
  m text := coalesce(p_customer ->> 'mode', 'entrega');
  pay text := coalesce(p_customer ->> 'payment', 'pix');
  clat float8; clng float8; dist float8;
  num int;
  st text;
  ord public.orders;
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.restaurant_can_sell(r) then raise exception 'Esta loja não está recebendo pedidos no momento'; end if;
  if not public.store_open_now(r) then raise exception 'A loja está fechada agora'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'Sacola vazia ou inválida';
  end if;
  if m not in ('entrega', 'retirada') then raise exception 'Escolha entrega ou retirada'; end if;
  if m = 'entrega' and not r.accepts_delivery then raise exception 'Esta loja não faz entrega'; end if;
  if m = 'retirada' and not r.accepts_pickup then raise exception 'Esta loja não aceita retirada'; end if;
  if not (pay = any (r.payment_methods)) then raise exception 'Forma de pagamento não aceita por esta loja'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    qty := greatest(1, least(50, coalesce((it ->> 'qty')::int, 1)));
    select * into p from public.products where id = (it ->> 'product_id')::bigint and restaurant_id = r.id and available;
    if not found then raise exception 'Um item da sacola não está mais disponível'; end if;
    sel := coalesce(it -> 'options', '[]'::jsonb);
    if jsonb_typeof(sel) <> 'array' then sel := '[]'::jsonb; end if;
    unit := p.price; opts := '[]'::jsonb;
    for g in select * from jsonb_array_elements(p.options) loop
      cnt := 0;
      for o in select * from jsonb_array_elements(coalesce(g -> 'items', '[]'::jsonb)) loop
        if sel ? (o ->> 'id') then
          cnt := cnt + 1;
          if g ->> 'kind' <> 'remove' then unit := unit + greatest(0, coalesce((o ->> 'price')::numeric, 0)); end if;
          opts := opts || to_jsonb(case g ->> 'kind' when 'remove' then 'Sem ' || (o ->> 'name')
                                                      when 'add' then '+ ' || (o ->> 'name')
                                                      else (g ->> 'title') || ': ' || (o ->> 'name') end);
        end if;
      end loop;
      if g ->> 'kind' = 'choose' and cnt <> 1 then
        raise exception 'Escolha uma opção em "%" (%)', g ->> 'title', p.name;
      end if;
      if nullif(g ->> 'max', '') is not null and cnt > (g ->> 'max')::int then
        raise exception 'Escolha no máximo % em "%" (%)', g ->> 'max', g ->> 'title', p.name;
      end if;
    end loop;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'qty', qty, 'price', unit,
      'opts', opts, 'note', left(coalesce(it ->> 'note', ''), 140));
    sub := sub + unit * qty;
  end loop;

  if sub < r.min_order then raise exception 'Pedido mínimo: R$ %', to_char(r.min_order, 'FM999990D00'); end if;

  if m = 'entrega' then
    if r.delivery_mode = 'bairro' and jsonb_array_length(r.delivery_zones) > 0 then
      select x into z from jsonb_array_elements(r.delivery_zones) x
       where lower(trim(x ->> 'name')) = lower(trim(coalesce(p_customer ->> 'zone', ''))) limit 1;
      if z is null then raise exception 'Escolha um bairro atendido pela loja'; end if;
      fee := coalesce((z ->> 'fee')::numeric, 0);
      info := left('Bairro ' || (z ->> 'name') || coalesce(' · ' || nullif(z ->> 'time', ''), ''), 120);
    elsif r.delivery_mode = 'distancia' and jsonb_array_length(r.delivery_zones) > 0 then
      if r.lat is not null and coalesce(p_customer ->> 'lat', '') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$'
         and coalesce(p_customer ->> 'lng', '') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
        clat := (p_customer ->> 'lat')::float8; clng := (p_customer ->> 'lng')::float8;
        geo := round(clat::numeric, 6) || ',' || round(clng::numeric, 6);
        -- distância aproximada de rua: linha reta × 1,3
        dist := 1.3 * 2 * 6371 * asin(sqrt(power(sin(radians(clat - r.lat) / 2), 2)
                + cos(radians(r.lat)) * cos(radians(clat)) * power(sin(radians(clng - r.lng) / 2), 2)));
        select x into z from jsonb_array_elements(r.delivery_zones) x
         where (x ->> 'km')::numeric >= dist order by (x ->> 'km')::numeric limit 1;
        if z is null then raise exception 'Seu endereço está fora da área de entrega (cerca de % km)', round(dist::numeric, 1); end if;
        info := left(round(dist::numeric, 1) || ' km' || coalesce(' · ' || nullif(z ->> 'time', ''), ''), 120);
      else
        select x into z from jsonb_array_elements(r.delivery_zones) x order by (x ->> 'fee')::numeric desc limit 1;
        info := left('Distância não informada · taxa máxima' || coalesce(' · ' || nullif(z ->> 'time', ''), ''), 120);
      end if;
      fee := coalesce((z ->> 'fee')::numeric, 0);
    else
      fee := r.delivery_fee;
      info := left(r.delivery_time, 120);
    end if;
  end if;

  -- Pix com chave cadastrada: o pedido espera o pagamento e só vai para a loja quando o cliente pagar
  st := case when pay = 'pix' and r.pix_key is not null then 'pagamento' else 'novo' end;
  if st = 'novo' then
    perform pg_advisory_xact_lock(hashtext(r.id::text));
    select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = r.id;
  else
    num := 0;
  end if;

  insert into public.orders (restaurant_id, number, customer_name, customer_phone, mode, address, payment, change_for, notes,
                             items, subtotal, fee, total, delivery_info, geo, status)
  values (r.id, num,
          left(trim(p_customer ->> 'name'), 80),
          left(regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9()+ -]', '', 'g'), 20),
          m,
          case when m = 'entrega' then left(p_customer ->> 'address', 300) end,
          pay,
          nullif(p_customer ->> 'change_for', '')::numeric,
          left(p_customer ->> 'notes', 300),
          lines, sub, fee, sub + fee, info, geo, st)
  returning * into ord;

  return jsonb_build_object('public_id', ord.public_id, 'number', ord.number, 'total', ord.total, 'subtotal', ord.subtotal,
    'fee', ord.fee, 'items', ord.items, 'whatsapp', r.whatsapp, 'restaurant', r.name,
    'delivery_info', ord.delivery_info, 'pix_key', r.pix_key, 'status', ord.status);
end;
$$;


-- Cliente pagou o Pix: o pedido ganha número e entra no painel da loja (com som)
create or replace function public.confirm_pix_paid(p_public_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; num int;
begin
  select * into o from public.orders where public_id = p_public_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status <> 'pagamento' then
    return jsonb_build_object('number', o.number, 'status', o.status);
  end if;
  perform pg_advisory_xact_lock(hashtext(o.restaurant_id::text));
  select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = o.restaurant_id;
  update public.orders set status = 'novo', number = num, pix_informed_at = now(), created_at = now()
   where id = o.id;
  return jsonb_build_object('number', num, 'status', 'novo');
end;
$$;

-- Cliente desistiu do Pix (voltou para trocar a forma de pagamento): o pedido é descartado
-- (fica como cancelado sem número e nunca aparece no painel da loja)
create or replace function public.cancel_pending_order(p_public_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  update public.orders set status = 'cancelado' where public_id = p_public_id and status = 'pagamento' returning true;
$$;

grant execute on function public.confirm_pix_paid(uuid) to anon, authenticated;
grant execute on function public.cancel_pending_order(uuid) to anon, authenticated;

-- ===================== pix-auto.sql =====================
-- BoraLanchar! — Pix com confirmação automática (rode depois de pix-fluxo.sql)
-- + função do servidor supabase/functions/pix (Mercado Pago)
alter table public.restaurants add column if not exists pix_auto boolean not null default false;
alter table public.orders add column if not exists mp_payment_id text check (char_length(mp_payment_id) <= 40);

-- Segredos da loja (token do Mercado Pago): ninguém lê pelo site, só a função do servidor
create table if not exists public.restaurant_secrets (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  mp_access_token text,
  mp_account text,
  updated_at timestamptz not null default now()
);
alter table public.restaurant_secrets enable row level security;
revoke all on public.restaurant_secrets from anon, authenticated;

-- Libera o pedido para a loja (número + status novo). Uso interno.
create or replace function public.release_order(p_order_id bigint, p_paid boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; num int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status <> 'pagamento' then
    if p_paid and not o.paid then update public.orders set paid = true where id = o.id; end if;
    return jsonb_build_object('number', o.number, 'status', o.status);
  end if;
  perform pg_advisory_xact_lock(hashtext(o.restaurant_id::text));
  select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = o.restaurant_id;
  update public.orders set status = 'novo', number = num, paid = p_paid, pix_informed_at = now(), created_at = now()
   where id = o.id;
  return jsonb_build_object('number', num, 'status', 'novo');
end;
$$;
revoke execute on function public.release_order(bigint, boolean) from public, anon, authenticated;

-- Dono confirma que o Pix caiu na conta: o pedido entra na fila
create or replace function public.owner_confirm_pix(p_order_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.orders where id = p_order_id;
  if rid is null or not (public.owns_restaurant(rid) or public.is_admin()) then raise exception 'Sem permissão'; end if;
  return public.release_order(p_order_id, true);
end;
$$;
revoke execute on function public.owner_confirm_pix(bigint) from public, anon;
grant execute on function public.owner_confirm_pix(bigint) to authenticated;

-- O cliente não confirma sozinho
revoke execute on function public.confirm_pix_paid(uuid) from public, anon, authenticated;

-- pix_auto só muda pelo servidor (ao conectar o Mercado Pago)
create or replace function public.restaurants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; iv jsonb;
begin
  if not public.is_admin() then
    new.plan := old.plan;
    new.status := old.status;
    new.trial_ends_at := old.trial_ends_at;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    if auth.uid() is not null then new.pix_auto := old.pix_auto; end if;
  end if;
  if new.name is distinct from old.name and new.slug = old.slug then
    new.slug := public.unique_slug(new.name, old.id);
  end if;
  new.slug := lower(new.slug);
  if new.slug <> old.slug then
    if exists (select 1 from public.restaurants where slug = new.slug and id <> old.id) then
      raise exception 'Este link já está em uso por outra loja';
    end if;
    new.old_slugs := (array_remove(old.old_slugs, new.slug) || old.slug)[greatest(1, cardinality(old.old_slugs) - 8):];
  end if;
  if new.opening_hours is not null then
    for k, iv in select key, value from jsonb_each(new.opening_hours) loop
      if k !~ '^[0-6]$' or jsonb_typeof(iv) <> 'array' then raise exception 'Horário inválido'; end if;
      perform (x ->> 0)::time, (x ->> 1)::time from jsonb_array_elements(iv) x;
    end loop;
  end if;
  return new;
end;
$$;
revoke execute on function public.restaurants_guard() from public, anon, authenticated;

-- ===================== admin-suporte.sql =====================
-- BoraLanchar! — área do dono do sistema: clientes e modo suporte (rode depois de pix-auto.sql)
create table if not exists public.support_log (
  id            bigint generated always as identity primary key,
  admin_email   text,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  created_at    timestamptz not null default now()
);
alter table public.support_log enable row level security;
drop policy if exists "admin le suporte" on public.support_log;
create policy "admin le suporte" on public.support_log for select to authenticated using (public.is_admin());
grant select on public.support_log to authenticated;

create or replace function public.admin_support_log(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  insert into public.support_log (admin_email, restaurant_id) values (auth.jwt() ->> 'email', p_rid);
end;
$$;
revoke execute on function public.admin_support_log(uuid) from public, anon;
grant execute on function public.admin_support_log(uuid) to authenticated;

create or replace function public.admin_clients()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  return query
  select to_jsonb(r) - 'old_slugs' || jsonb_build_object(
           'owner_email', u.email,
           'owner_name', u.raw_user_meta_data ->> 'nome',
           'last_sign_in', u.last_sign_in_at,
           'orders_30d', coalesce(o.n, 0),
           'revenue_30d', coalesce(o.total, 0),
           'last_order', o.last_at,
           'products', coalesce(p.n, 0))
  from public.restaurants r
  left join auth.users u on u.id = r.owner_id
  left join lateral (
    select count(*) n, sum(total) total, max(created_at) last_at from public.orders
     where restaurant_id = r.id and status not in ('pagamento', 'cancelado') and created_at > now() - interval '30 days'
  ) o on true
  left join lateral (select count(*) n from public.products where restaurant_id = r.id) p on true
  order by r.created_at desc;
end;
$$;
revoke execute on function public.admin_clients() from public, anon;
grant execute on function public.admin_clients() to authenticated;

-- fotos no modo suporte
drop policy if exists "admin envia fotos" on storage.objects;
create policy "admin envia fotos" on storage.objects for insert to authenticated with check (bucket_id = 'produtos' and public.is_admin());
drop policy if exists "admin troca fotos" on storage.objects;
create policy "admin troca fotos" on storage.objects for update to authenticated using (bucket_id = 'produtos' and public.is_admin());
drop policy if exists "admin apaga fotos" on storage.objects;
create policy "admin apaga fotos" on storage.objects for delete to authenticated using (bucket_id = 'produtos' and public.is_admin());
