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

insert into public.admins (email) values ('boralancharadm@gmail.com')
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

-- e-mail de acesso do administrador do site
insert into public.admins (email) values ('boralancharadm@gmail.com') on conflict do nothing;

-- ===================== assinaturas.sql =====================
-- BoraLanchar! — pagamento dos planos (rode depois de admin-suporte.sql)
-- + função do servidor supabase/functions/assinatura (Mercado Pago)
grant execute on function public.release_order(bigint, boolean) to service_role;
alter table public.restaurants add column if not exists paid_until timestamptz;

create table if not exists public.platform_settings (
  id int primary key default 1 check (id = 1),
  pix_key text check (char_length(pix_key) <= 77),
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cpf','cnpj','celular','email','aleatoria')),
  pix_name text check (char_length(pix_name) <= 25),
  pix_city text check (char_length(pix_city) <= 15),
  pix_bank text check (char_length(pix_bank) <= 40),
  mp_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists "todos leem cobranca" on public.platform_settings;
create policy "todos leem cobranca" on public.platform_settings for select to anon, authenticated using (true);
drop policy if exists "admin edita cobranca" on public.platform_settings;
create policy "admin edita cobranca" on public.platform_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.platform_settings to anon, authenticated;
grant update (pix_key, pix_key_type, pix_name, pix_city, pix_bank, updated_at) on public.platform_settings to authenticated;

create table if not exists public.platform_secrets (
  id int primary key default 1 check (id = 1), mp_access_token text, mp_account text, updated_at timestamptz not null default now());
alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from anon, authenticated;

create table if not exists public.subscription_payments (
  id bigint generated always as identity primary key,
  public_id uuid not null unique default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  plan text not null check (plan in ('Essencial', 'Profissional', 'Completo')),
  amount numeric(8,2) not null,
  method text not null check (method in ('pix', 'cartao', 'boleto')),
  status text not null default 'pendente' check (status in ('pendente', 'pago', 'cancelado')),
  mp_ref text check (char_length(mp_ref) <= 60),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists subpay_rest_idx on public.subscription_payments (restaurant_id, created_at desc);
alter table public.subscription_payments enable row level security;
drop policy if exists "dono ve suas assinaturas" on public.subscription_payments;
create policy "dono ve suas assinaturas" on public.subscription_payments for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin());
grant select on public.subscription_payments to authenticated;

create or replace function public.plan_price(p text) returns numeric language sql immutable set search_path = public as $$
  select case p when 'Essencial' then 39.99 when 'Profissional' then 59.99 when 'Completo' then 79.99 end::numeric; $$;

create or replace function public.start_subscription(p_plan text, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid; sp public.subscription_payments;
begin
  select id into rid from public.restaurants where owner_id = auth.uid();
  if rid is null then raise exception 'Crie sua conta primeiro'; end if;
  if public.plan_price(p_plan) is null then raise exception 'Plano inválido'; end if;
  if p_method not in ('pix', 'cartao', 'boleto') then raise exception 'Forma de pagamento inválida'; end if;
  update public.subscription_payments set status = 'cancelado' where restaurant_id = rid and status = 'pendente';
  insert into public.subscription_payments (restaurant_id, plan, amount, method) values (rid, p_plan, public.plan_price(p_plan), p_method) returning * into sp;
  return to_jsonb(sp);
end; $$;
revoke execute on function public.start_subscription(text, text) from public, anon;
grant execute on function public.start_subscription(text, text) to authenticated;

create or replace function public.mark_subscription_paid(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sp public.subscription_payments; r public.restaurants;
begin
  select * into sp from public.subscription_payments where id = p_id for update;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if sp.status <> 'pago' then
    update public.subscription_payments set status = 'pago', paid_at = now() where id = sp.id;
    update public.restaurants set status = 'ativo', plan = sp.plan,
      paid_until = greatest(coalesce(paid_until, now()), now()) + interval '30 days' where id = sp.restaurant_id;
  end if;
  select * into r from public.restaurants where id = sp.restaurant_id;
  return jsonb_build_object('status', 'pago', 'plan', r.plan, 'paid_until', r.paid_until);
end; $$;
revoke execute on function public.mark_subscription_paid(bigint) from public, anon, authenticated;
grant execute on function public.mark_subscription_paid(bigint) to service_role;

create or replace function public.admin_confirm_subscription(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public.is_admin() then raise exception 'Sem permissão'; end if; return public.mark_subscription_paid(p_id); end; $$;
revoke execute on function public.admin_confirm_subscription(bigint) from public, anon;
grant execute on function public.admin_confirm_subscription(bigint) to authenticated;

create or replace function public.admin_cancel_subscription(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin if not public.is_admin() then raise exception 'Sem permissão'; end if;
  update public.subscription_payments set status = 'cancelado' where id = p_id and status = 'pendente'; end; $$;
revoke execute on function public.admin_cancel_subscription(bigint) from public, anon;
grant execute on function public.admin_cancel_subscription(bigint) to authenticated;

-- plano pago vale até paid_until (+3 dias de tolerância)
create or replace function public.restaurant_can_sell(r public.restaurants)
returns boolean language sql stable set search_path = public as $$
  select (r.status = 'ativo' and (r.paid_until is null or r.paid_until > now() - interval '3 days'))
      or (r.status = 'teste' and r.trial_ends_at > now()); $$;

-- proteções: dono não mexe em plano/status/pagamento; servidor e admin podem
create or replace function public.restaurants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text; iv jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    new.plan := old.plan; new.status := old.status; new.trial_ends_at := old.trial_ends_at; new.paid_until := old.paid_until;
    new.owner_id := old.owner_id; new.created_at := old.created_at; new.pix_auto := old.pix_auto;
  end if;
  if new.name is distinct from old.name and new.slug = old.slug then new.slug := public.unique_slug(new.name, old.id); end if;
  new.slug := lower(new.slug);
  if new.slug <> old.slug then
    if exists (select 1 from public.restaurants where slug = new.slug and id <> old.id) then raise exception 'Este link já está em uso por outra loja'; end if;
    new.old_slugs := (array_remove(old.old_slugs, new.slug) || old.slug)[greatest(1, cardinality(old.old_slugs) - 8):];
  end if;
  if new.opening_hours is not null then
    for k, iv in select key, value from jsonb_each(new.opening_hours) loop
      if k !~ '^[0-6]$' or jsonb_typeof(iv) <> 'array' then raise exception 'Horário inválido'; end if;
      perform (x ->> 0)::time, (x ->> 1)::time from jsonb_array_elements(iv) x;
    end loop;
  end if;
  return new;
end; $$;
revoke execute on function public.restaurants_guard() from public, anon, authenticated;

-- ===================== cancelar-excluir.sql =====================
-- BoraLanchar! — cancelar assinatura / excluir loja (rode depois de assinaturas.sql)
-- A exclusão é feita pela função do servidor supabase/functions/admin-loja (só administrador).
alter table public.restaurants drop constraint if exists restaurants_status_check;
alter table public.restaurants add constraint restaurants_status_check check (status in ('teste', 'ativo', 'suspenso', 'cancelado'));
alter table public.restaurants add column if not exists canceled_at timestamptz;

create or replace function public.admin_cancel_restaurant(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  update public.restaurants set status = 'cancelado', canceled_at = now(), is_open = false where id = p_rid;
  update public.subscription_payments set status = 'cancelado' where restaurant_id = p_rid and status = 'pendente';
end;
$$;
revoke execute on function public.admin_cancel_restaurant(uuid) from public, anon;
grant execute on function public.admin_cancel_restaurant(uuid) to authenticated;
-- ============================================================
-- BoraLanchar! — Foto do produto gerada por IA
-- Registro de uso (limite mensal por loja). Só a função do servidor mexe aqui.
-- + função do servidor supabase/functions/foto-produto (precisa do segredo GEMINI_API_KEY)
-- ============================================================
create table if not exists public.ai_image_log (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_name text check (char_length(product_name) <= 120),
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_image_log_rest_idx on public.ai_image_log (restaurant_id, created_at desc);
alter table public.ai_image_log enable row level security;
-- (sem políticas: o site não lê nem escreve; só o servidor)


-- =====================================================================
-- Recursos por plano (cupons, fidelidade, mesas/garçom, estoque, financeiro, caixa de entrada)
-- =====================================================================
-- ============================================================
-- BoraLanchar! — Recursos por plano
--   Profissional: Robô no WhatsApp, Caixa de entrada única, Cupons e fidelidade
--   Completo:     + App do garçom e mesas, Estoque e financeiro, Suporte prioritário
-- Rode depois do instalar-tudo.sql e do whatsapp-robo.sql. Pode rodar de novo sem problema.
-- ============================================================

-- ---------- 1. Plano → recursos ----------
create or replace function public.plan_has(p_plan text, p_feature text)
returns boolean language sql immutable as $$
  select case
    when p_feature in ('robo', 'inbox', 'cupons') then coalesce(p_plan, '') in ('Profissional', 'Completo')
    when p_feature in ('mesas', 'estoque', 'prioritario') then coalesce(p_plan, '') = 'Completo'
    else true end;
$$;
grant execute on function public.plan_has(text, text) to anon, authenticated;

-- dono da loja + plano com o recurso (ou admin)
create or replace function public.owns_feature(rid uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.restaurants r where r.id = rid and r.owner_id = auth.uid() and public.plan_has(r.plan, p_feature));
$$;
grant execute on function public.owns_feature(uuid, text) to authenticated;

-- telefone só com números, sem o 55 (10 ou 11 dígitos) — chave do cartão fidelidade
create or replace function public.bora_phone(p text)
returns text language sql immutable as $$
  select case when length(d) between 10 and 11 then d end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^55(?=\d{10,11}$)', '') d) x;
$$;

-- ---------- 2. Pedidos: colunas novas ----------
alter table public.orders add column if not exists discount numeric(10,2) not null default 0;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists reward_used boolean not null default false;
alter table public.orders add column if not exists loyalty_stamped boolean not null default false;
alter table public.orders add column if not exists table_id bigint;
alter table public.orders add column if not exists bill_id bigint;
alter table public.orders add column if not exists waiter text;
alter table public.orders add column if not exists stock_done boolean not null default false;
alter table public.orders drop constraint if exists orders_mode_check;
alter table public.orders add constraint orders_mode_check check (mode = any (array['entrega', 'retirada', 'mesa']));
alter table public.orders drop constraint if exists orders_payment_check;
alter table public.orders add constraint orders_payment_check check (payment = any (array['pix', 'cartao', 'dinheiro', 'mesa']));
alter table public.orders drop constraint if exists orders_customer_phone_check;
alter table public.orders add constraint orders_customer_phone_check check (char_length(customer_phone) <= 20 and (mode = 'mesa' or char_length(customer_phone) >= 8));
alter table public.orders drop constraint if exists orders_extra_check;
alter table public.orders add constraint orders_extra_check check (char_length(coupon_code) <= 30 and char_length(waiter) <= 60 and discount >= 0);

-- ---------- 3. Cupons ----------
create table if not exists public.coupons (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,20}$'),
  kind text not null check (kind in ('percent', 'fixed', 'frete')),
  value numeric(10,2) not null default 0 check (value >= 0 and value <= 10000),
  min_order numeric(10,2) not null default 0 check (min_order >= 0),
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  once_per_customer boolean not null default true,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, code),
  check (kind <> 'percent' or value <= 100)
);
alter table public.coupons enable row level security;
create table if not exists public.coupon_uses (
  id bigint generated always as identity primary key,
  coupon_id bigint not null references public.coupons (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text,
  order_id bigint references public.orders (id) on delete cascade,
  voided boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists coupon_uses_idx on public.coupon_uses (coupon_id, phone);
alter table public.coupon_uses enable row level security;

-- ---------- 4. Fidelidade (compre N, ganhe 1) ----------
alter table public.restaurants add column if not exists loyalty_enabled boolean not null default false;
alter table public.restaurants add column if not exists loyalty_goal int not null default 10;
alter table public.restaurants add column if not exists loyalty_reward numeric(8,2) not null default 0;
alter table public.restaurants add column if not exists loyalty_min numeric(8,2) not null default 0;
alter table public.restaurants drop constraint if exists restaurants_loyalty_check;
alter table public.restaurants add constraint restaurants_loyalty_check check (loyalty_goal between 2 and 50 and loyalty_reward between 0 and 1000 and loyalty_min between 0 and 10000);
create table if not exists public.loyalty_cards (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  name text check (char_length(name) <= 80),
  stamps int not null default 0,
  rewards int not null default 0,
  orders int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, phone)
);
alter table public.loyalty_cards enable row level security;

-- ---------- 5. Mesas e garçom ----------
create table if not exists public.dining_tables (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 30),
  token uuid not null unique default gen_random_uuid(),
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (restaurant_id, label)
);
alter table public.dining_tables enable row level security;
create table if not exists public.table_bills (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id bigint not null references public.dining_tables (id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  subtotal numeric(10,2),
  service numeric(10,2) not null default 0,
  total numeric(10,2),
  payment text check (payment in ('pix', 'cartao', 'dinheiro')),
  closed_by text check (char_length(closed_by) <= 60)
);
create unique index if not exists table_bills_open on public.table_bills (table_id) where closed_at is null;
create index if not exists table_bills_rest on public.table_bills (restaurant_id, closed_at);
alter table public.table_bills enable row level security;
create table if not exists public.waiters (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.waiters enable row level security;
create table if not exists public.waiter_sessions (
  token uuid primary key default gen_random_uuid(),
  waiter_id bigint not null references public.waiters (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '16 hours'
);
alter table public.waiter_sessions enable row level security;
create table if not exists public.waiter_attempts (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  ok boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists waiter_attempts_idx on public.waiter_attempts (restaurant_id, at desc);
alter table public.waiter_attempts enable row level security;

-- ---------- 6. Estoque ----------
create table if not exists public.stock_items (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  unit text not null default 'un' check (unit in ('un', 'g', 'kg', 'ml', 'l', 'pct', 'fatia')),
  qty numeric(12,3) not null default 0,
  min_qty numeric(12,3) not null default 0 check (min_qty >= 0),
  cost numeric(12,4) not null default 0 check (cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.stock_items enable row level security;
create table if not exists public.product_recipes (
  product_id bigint not null references public.products (id) on delete cascade,
  stock_item_id bigint not null references public.stock_items (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  qty numeric(12,3) not null check (qty > 0 and qty < 100000),
  primary key (product_id, stock_item_id)
);
alter table public.product_recipes enable row level security;
create table if not exists public.stock_moves (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stock_item_id bigint not null references public.stock_items (id) on delete cascade,
  delta numeric(12,3) not null,
  reason text not null check (reason in ('pedido', 'entrada', 'ajuste', 'perda', 'estorno')),
  order_id bigint,
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists stock_moves_idx on public.stock_moves (restaurant_id, created_at desc);
alter table public.stock_moves enable row level security;

-- ---------- 7. Financeiro ----------
create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  spent_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  description text not null check (char_length(description) between 1 and 80),
  category text check (char_length(category) <= 30),
  amount numeric(10,2) not null check (amount > 0 and amount < 10000000),
  created_at timestamptz not null default now()
);
create index if not exists expenses_idx on public.expenses (restaurant_id, spent_on desc);
alter table public.expenses enable row level security;
create table if not exists public.cash_sessions (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  opened_at timestamptz not null default now(),
  opening numeric(10,2) not null default 0 check (opening >= 0),
  closed_at timestamptz,
  expected numeric(10,2),
  counted numeric(10,2),
  note text check (char_length(note) <= 200)
);
create unique index if not exists cash_sessions_open on public.cash_sessions (restaurant_id) where closed_at is null;
alter table public.cash_sessions enable row level security;
create table if not exists public.cash_moves (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.cash_sessions (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind text not null check (kind in ('suprimento', 'sangria')),
  amount numeric(10,2) not null check (amount > 0),
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now()
);
alter table public.cash_moves enable row level security;

-- ---------- 8. Caixa de entrada: chat do site ----------
create table if not exists public.chat_threads (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  token uuid not null unique,
  name text not null check (char_length(name) between 1 and 80),
  phone text check (char_length(phone) <= 20),
  last_msg_at timestamptz not null default now(),
  unread int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists chat_threads_idx on public.chat_threads (restaurant_id, last_msg_at desc);
alter table public.chat_threads enable row level security;
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.chat_threads (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  sender text not null check (sender in ('cliente', 'loja')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_idx on public.chat_messages (thread_id, created_at desc);
alter table public.chat_messages enable row level security;

-- ---------- 9. Permissões (RLS) ----------
do $$
declare t text; f text;
begin
  -- tabelas que o dono lê e edita direto (com o plano certo)
  for t, f in select * from (values ('coupons', 'cupons'), ('dining_tables', 'mesas'), ('stock_items', 'estoque'), ('product_recipes', 'estoque'), ('expenses', 'estoque')) v(a, b) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'dono le ' || t) then
      execute format('create policy %I on public.%I for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin())', 'dono le ' || t, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'dono cria ' || t) then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.owns_feature(restaurant_id, %L))', 'dono cria ' || t, t, f);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'dono edita ' || t) then
      execute format('create policy %I on public.%I for update to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin()) with check (public.owns_feature(restaurant_id, %L))', 'dono edita ' || t, t, f);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'dono apaga ' || t) then
      execute format('create policy %I on public.%I for delete to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin())', 'dono apaga ' || t, t);
    end if;
  end loop;
  -- só leitura pelo painel (escrita pelas funções do banco)
  foreach t in array array['coupon_uses', 'loyalty_cards', 'table_bills', 'waiters', 'stock_moves', 'cash_sessions', 'cash_moves', 'chat_threads', 'chat_messages'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'dono le ' || t) then
      execute format('create policy %I on public.%I for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin())', 'dono le ' || t, t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_threads' and policyname = 'dono marca lida') then
    create policy "dono marca lida" on public.chat_threads for update to authenticated
      using (public.owns_restaurant(restaurant_id) or public.is_admin()) with check (public.owns_restaurant(restaurant_id) or public.is_admin());
  end if;
end $$;

-- a ficha técnica só liga produto e insumo da mesma loja
create or replace function public.product_recipes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = new.product_id and restaurant_id = new.restaurant_id)
     or not exists (select 1 from public.stock_items where id = new.stock_item_id and restaurant_id = new.restaurant_id) then
    raise exception 'Produto e insumo precisam ser da mesma loja';
  end if;
  return new;
end;
$$;
create or replace trigger product_recipes_guard before insert or update on public.product_recipes
for each row execute function public.product_recipes_guard();

-- cupom sempre em maiúsculas; "uses" só muda pelo banco
create or replace function public.coupons_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.code := upper(trim(new.code));
  if tg_op = 'UPDATE' and coalesce(auth.role(), '') <> 'service_role' and current_setting('bora.sys', true) is distinct from '1' then
    new.uses := old.uses; new.restaurant_id := old.restaurant_id;
  elsif tg_op = 'INSERT' then new.uses := 0;
  end if;
  return new;
end;
$$;
create or replace trigger coupons_guard before insert or update on public.coupons
for each row execute function public.coupons_guard();

-- tempo real no painel
do $$ begin
  begin alter publication supabase_realtime add table public.chat_threads; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.table_bills; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ============================================================
-- FUNÇÕES
-- ============================================================

-- ---------- cupom: confere e calcula o desconto ----------
create or replace function public._coupon_check(r public.restaurants, p_code text, p_sub numeric, p_fee numeric, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.coupons; ph text := public.bora_phone(p_phone); d numeric(10,2);
begin
  if not public.plan_has(r.plan, 'cupons') then return jsonb_build_object('ok', false, 'error', 'Esta loja não usa cupons'); end if;
  select * into c from public.coupons where restaurant_id = r.id and code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'Cupom não encontrado'); end if;
  if c.expires_at is not null and c.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'Este cupom expirou'); end if;
  if c.max_uses is not null and c.uses >= c.max_uses then return jsonb_build_object('ok', false, 'error', 'Este cupom já esgotou'); end if;
  if p_sub < c.min_order then return jsonb_build_object('ok', false, 'error', 'Cupom válido para pedidos a partir de R$ ' || to_char(c.min_order, 'FM999990D00')); end if;
  if c.once_per_customer and ph is not null and exists (select 1 from public.coupon_uses u where u.coupon_id = c.id and u.phone = ph and not u.voided) then
    return jsonb_build_object('ok', false, 'error', 'Você já usou este cupom');
  end if;
  d := case c.kind when 'percent' then round(p_sub * c.value / 100, 2) when 'fixed' then least(c.value, p_sub) else coalesce(p_fee, 0) end;
  return jsonb_build_object('ok', true, 'coupon_id', c.id, 'code', c.code, 'kind', c.kind, 'value', c.value, 'discount', greatest(0, d),
    'label', case c.kind when 'percent' then trim(to_char(c.value, 'FM990D##')) || '% de desconto' when 'fixed' then 'R$ ' || to_char(c.value, 'FM999990D00') || ' de desconto' else 'Entrega grátis' end);
end;
$$;
revoke execute on function public._coupon_check(public.restaurants, text, numeric, numeric, text) from public, anon, authenticated;

create or replace function public.check_coupon(p_slug text, p_code text, p_subtotal numeric, p_fee numeric default 0, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then return jsonb_build_object('ok', false, 'error', 'Loja não encontrada'); end if;
  return public._coupon_check(r, p_code, coalesce(p_subtotal, 0), coalesce(p_fee, 0), p_phone);
end;
$$;
grant execute on function public.check_coupon(text, text, numeric, numeric, text) to anon, authenticated;

-- ---------- fidelidade: cartão do cliente ----------
create or replace function public.loyalty_status(p_slug text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.restaurants; c public.loyalty_cards; ph text := public.bora_phone(p_phone);
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found or not r.loyalty_enabled or not public.plan_has(r.plan, 'cupons') then return jsonb_build_object('enabled', false); end if;
  if ph is not null then select * into c from public.loyalty_cards where restaurant_id = r.id and phone = ph; end if;
  return jsonb_build_object('enabled', true, 'goal', r.loyalty_goal, 'reward', r.loyalty_reward, 'min', r.loyalty_min,
    'stamps', coalesce(c.stamps, 0), 'rewards', coalesce(c.rewards, 0));
end;
$$;
grant execute on function public.loyalty_status(text, text) to anon, authenticated;

-- ---------- mesa pelo QR Code ----------
create or replace function public.table_info(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.dining_tables;
begin
  if coalesce(p_token, '') !~* '^[0-9a-f-]{36}$' then return null; end if;
  select d.* into t from public.dining_tables d join public.restaurants r on r.id = d.restaurant_id
   where d.token = p_token::uuid and r.slug = lower(p_slug) and d.active and public.plan_has(r.plan, 'mesas');
  if not found then return null; end if;
  return jsonb_build_object('id', t.id, 'label', t.label);
end;
$$;
grant execute on function public.table_info(text, text) to anon, authenticated;

-- ---------- pedido (delivery, retirada e mesa) ----------
create or replace function public.place_order(p_slug text, p_customer jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  it jsonb; p public.products; g jsonb; o jsonb; sel jsonb; z jsonb;
  qty int; cnt int; unit numeric(10,2);
  opts jsonb;
  lines jsonb := '[]'::jsonb;
  sub numeric(10,2) := 0;
  fee numeric(8,2) := 0;
  disc numeric(10,2) := 0;
  info text := null; geo text := null;
  m text := coalesce(p_customer ->> 'mode', 'entrega');
  pay text := coalesce(p_customer ->> 'payment', 'pix');
  clat float8; clng float8; dist float8;
  num int;
  st text;
  ord public.orders;
  tb public.dining_tables; bill_id bigint := null;
  cj jsonb; cid bigint := null; ccode text := null; rew boolean := false; ph text;
  wname text := nullif(current_setting('bora.waiter', true), '');
  cname text := left(trim(coalesce(p_customer ->> 'name', '')), 80);
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.restaurant_can_sell(r) then raise exception 'Esta loja não está recebendo pedidos no momento'; end if;
  if not public.store_open_now(r) then raise exception 'A loja está fechada agora'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'Sacola vazia ou inválida';
  end if;

  -- pedido na mesa (QR Code da mesa ou garçom)
  if nullif(p_customer ->> 'table', '') is not null then
    if not public.plan_has(r.plan, 'mesas') then raise exception 'Esta loja não recebe pedidos na mesa'; end if;
    if (p_customer ->> 'table') !~* '^[0-9a-f-]{36}$' then raise exception 'Mesa não encontrada. Leia o QR Code da mesa de novo.'; end if;
    select * into tb from public.dining_tables where token = (p_customer ->> 'table')::uuid and restaurant_id = r.id and active;
    if not found then raise exception 'Mesa não encontrada. Leia o QR Code da mesa de novo.'; end if;
    m := 'mesa'; pay := 'mesa';
    if cname = '' then cname := 'Mesa ' || tb.label; end if;
  else
    if m not in ('entrega', 'retirada') then raise exception 'Escolha entrega ou retirada'; end if;
    if m = 'entrega' and not r.accepts_delivery then raise exception 'Esta loja não faz entrega'; end if;
    if m = 'retirada' and not r.accepts_pickup then raise exception 'Esta loja não aceita retirada'; end if;
    if not (pay = any (r.payment_methods)) then raise exception 'Forma de pagamento não aceita por esta loja'; end if;
    wname := null;
  end if;
  if cname = '' then raise exception 'Informe seu nome'; end if;

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

  if m <> 'mesa' and sub < r.min_order then raise exception 'Pedido mínimo: R$ %', to_char(r.min_order, 'FM999990D00'); end if;

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
  elsif m = 'mesa' then
    info := left('Mesa ' || tb.label || coalesce(' · garçom ' || wname, ''), 120);
  end if;

  -- cupom e prêmio de fidelidade (plano Profissional ou Completo)
  if m <> 'mesa' and public.plan_has(r.plan, 'cupons') then
    if nullif(trim(coalesce(p_customer ->> 'coupon', '')), '') is not null then
      cj := public._coupon_check(r, p_customer ->> 'coupon', sub, fee, p_customer ->> 'phone');
      if not (cj ->> 'ok')::boolean then raise exception '%', cj ->> 'error'; end if;
      disc := (cj ->> 'discount')::numeric; ccode := cj ->> 'code'; cid := (cj ->> 'coupon_id')::bigint;
    end if;
    if coalesce(p_customer ->> 'use_reward', '') = 'true' and r.loyalty_enabled and r.loyalty_reward > 0 then
      ph := public.bora_phone(p_customer ->> 'phone');
      update public.loyalty_cards set rewards = rewards - 1, updated_at = now()
       where restaurant_id = r.id and phone = ph and rewards > 0;
      if not found then raise exception 'Você ainda não tem prêmio de fidelidade para usar'; end if;
      disc := disc + least(r.loyalty_reward, sub + fee - disc); rew := true;
    end if;
  end if;
  disc := greatest(0, least(disc, sub + fee));

  st := case when m <> 'mesa' and pay = 'pix' and r.pix_key is not null and sub + fee - disc > 0 then 'pagamento' else 'novo' end;
  if st = 'novo' then
    perform pg_advisory_xact_lock(hashtext(r.id::text));
    select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = r.id;
  else
    num := 0;
  end if;

  if m = 'mesa' then
    perform pg_advisory_xact_lock(hashtext('mesa' || tb.id::text));
    select id into bill_id from public.table_bills where table_id = tb.id and closed_at is null;
    if bill_id is null then
      insert into public.table_bills (restaurant_id, table_id) values (r.id, tb.id) returning id into bill_id;
    end if;
  end if;

  insert into public.orders (restaurant_id, number, customer_name, customer_phone, mode, address, payment, change_for, notes,
                             items, subtotal, fee, discount, total, delivery_info, geo, status, coupon_code, reward_used, table_id, bill_id, waiter)
  values (r.id, num,
          cname,
          left(regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9()+ -]', '', 'g'), 20),
          m,
          case when m = 'entrega' then left(p_customer ->> 'address', 300) end,
          pay,
          case when m <> 'mesa' then nullif(p_customer ->> 'change_for', '')::numeric end,
          left(p_customer ->> 'notes', 300),
          lines, sub, fee, disc, sub + fee - disc, info, geo, st, ccode, rew, tb.id, bill_id, left(wname, 60))
  returning * into ord;

  if cid is not null then
    perform set_config('bora.sys', '1', true);
    update public.coupons set uses = uses + 1 where id = cid;
    insert into public.coupon_uses (coupon_id, restaurant_id, phone, order_id) values (cid, r.id, public.bora_phone(p_customer ->> 'phone'), ord.id);
    perform set_config('bora.sys', '', true);
  end if;

  return jsonb_build_object('public_id', ord.public_id, 'number', ord.number, 'total', ord.total, 'subtotal', ord.subtotal,
    'fee', ord.fee, 'discount', ord.discount, 'coupon', ord.coupon_code, 'items', ord.items, 'whatsapp', r.whatsapp, 'restaurant', r.name,
    'delivery_info', ord.delivery_info, 'pix_key', r.pix_key, 'status', ord.status, 'mode', ord.mode);
end;
$$;
grant execute on function public.place_order(text, jsonb, jsonb) to anon, authenticated;

-- ---------- depois que o status do pedido muda: fidelidade, estoque e estornos ----------
create or replace function public.orders_after_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.restaurants; ph text; it jsonb; rc record; q numeric;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into r from public.restaurants where id = new.restaurant_id;

  -- selo de fidelidade quando o pedido é entregue
  if new.status = 'entregue' and not new.loyalty_stamped and new.mode <> 'mesa'
     and r.loyalty_enabled and public.plan_has(r.plan, 'cupons') and new.subtotal >= r.loyalty_min then
    ph := public.bora_phone(new.customer_phone);
    if ph is not null then
      insert into public.loyalty_cards (restaurant_id, phone, name, stamps, orders) values (r.id, ph, new.customer_name, 1, 1)
      on conflict (restaurant_id, phone) do update set stamps = public.loyalty_cards.stamps + 1, orders = public.loyalty_cards.orders + 1,
        name = excluded.name, updated_at = now();
      update public.loyalty_cards set stamps = stamps - r.loyalty_goal, rewards = rewards + 1
       where restaurant_id = r.id and phone = ph and stamps >= r.loyalty_goal;
      update public.orders set loyalty_stamped = true where id = new.id;
    end if;
  end if;

  -- baixa no estoque quando a loja aceita o pedido
  if new.status in ('preparo', 'pronto', 'saiu', 'entregue') and not new.stock_done and public.plan_has(r.plan, 'estoque') then
    for it in select * from jsonb_array_elements(new.items) loop
      for rc in select pr.stock_item_id, pr.qty from public.product_recipes pr
                 where pr.product_id = (it ->> 'product_id')::bigint and pr.restaurant_id = r.id loop
        q := rc.qty * coalesce((it ->> 'qty')::numeric, 1);
        update public.stock_items set qty = qty - q, updated_at = now() where id = rc.stock_item_id;
        insert into public.stock_moves (restaurant_id, stock_item_id, delta, reason, order_id, note)
        values (r.id, rc.stock_item_id, -q, 'pedido', new.id, 'Pedido #' || new.number);
      end loop;
    end loop;
    update public.orders set stock_done = true where id = new.id;
  end if;

  -- pedido cancelado: devolve cupom, prêmio e estoque
  if new.status = 'cancelado' then
    if new.reward_used then
      update public.loyalty_cards set rewards = rewards + 1, updated_at = now()
       where restaurant_id = r.id and phone = public.bora_phone(new.customer_phone);
      update public.orders set reward_used = false where id = new.id;
    end if;
    if new.coupon_code is not null then
      update public.coupon_uses set voided = true where order_id = new.id and not voided;
      if found then
        perform set_config('bora.sys', '1', true);
        update public.coupons set uses = greatest(0, uses - 1) where restaurant_id = r.id and code = new.coupon_code;
        perform set_config('bora.sys', '', true);
      end if;
    end if;
    if new.stock_done then
      for rc in select stock_item_id, -sum(delta) q from public.stock_moves where order_id = new.id and reason = 'pedido' group by stock_item_id loop
        update public.stock_items set qty = qty + rc.q, updated_at = now() where id = rc.stock_item_id;
        insert into public.stock_moves (restaurant_id, stock_item_id, delta, reason, order_id, note)
        values (r.id, rc.stock_item_id, rc.q, 'estorno', new.id, 'Pedido #' || new.number || ' cancelado');
      end loop;
      update public.orders set stock_done = false where id = new.id;
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger orders_after_status after update of status on public.orders
for each row execute function public.orders_after_status();

-- ---------- fechar a conta da mesa ----------
create or replace function public._close_bill(p_bill bigint, p_payment text, p_service_pct numeric, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.table_bills; s numeric(10,2); sv numeric(10,2);
begin
  select * into b from public.table_bills where id = p_bill for update;
  if not found or b.closed_at is not null then raise exception 'Esta conta já foi fechada'; end if;
  if p_payment not in ('pix', 'cartao', 'dinheiro') then raise exception 'Escolha a forma de pagamento'; end if;
  select coalesce(sum(total), 0) into s from public.orders where bill_id = b.id and status <> 'cancelado';
  sv := round(s * greatest(0, least(coalesce(p_service_pct, 0), 20)) / 100, 2);
  update public.table_bills set closed_at = now(), subtotal = s, service = sv, total = s + sv, payment = p_payment, closed_by = left(p_by, 60)
   where id = b.id returning * into b;
  update public.orders set paid = true where bill_id = b.id and status <> 'cancelado';
  update public.orders set status = 'entregue' where bill_id = b.id and status in ('novo', 'preparo', 'pronto');
  return to_jsonb(b);
end;
$$;
revoke execute on function public._close_bill(bigint, text, numeric, text) from public, anon, authenticated;

create or replace function public.owner_close_bill(p_bill bigint, p_payment text, p_service_pct numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.table_bills where id = p_bill;
  if rid is null or not public.owns_feature(rid, 'mesas') then raise exception 'Sem permissão'; end if;
  return public._close_bill(p_bill, p_payment, p_service_pct, 'Caixa');
end;
$$;
grant execute on function public.owner_close_bill(bigint, text, numeric) to authenticated;

-- ---------- garçom: cadastro com PIN ----------
create or replace function public.waiter_save(p_rid uuid, p_id bigint, p_name text, p_pin text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare w public.waiters;
begin
  if not public.owns_feature(p_rid, 'mesas') then raise exception 'Sem permissão'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,6}$' then raise exception 'O PIN precisa ter de 4 a 6 números'; end if;
  if p_id is null then
    if p_pin is null then raise exception 'Crie um PIN para o garçom'; end if;
    insert into public.waiters (restaurant_id, name, pin_hash, active)
    values (p_rid, left(trim(p_name), 40), crypt(p_pin, gen_salt('bf', 8)), coalesce(p_active, true)) returning * into w;
  else
    update public.waiters set name = left(trim(coalesce(p_name, name)), 40), active = coalesce(p_active, active),
      pin_hash = case when p_pin is null then pin_hash else crypt(p_pin, gen_salt('bf', 8)) end
     where id = p_id and restaurant_id = p_rid returning * into w;
    if not found then raise exception 'Garçom não encontrado'; end if;
    if not w.active then update public.waiter_sessions set expires_at = now() where waiter_id = w.id; end if;
  end if;
  return jsonb_build_object('id', w.id, 'name', w.name, 'active', w.active);
end;
$$;
grant execute on function public.waiter_save(uuid, bigint, text, text, boolean) to authenticated;

-- ---------- garçom: entrar com o PIN ----------
create or replace function public.waiter_login(p_slug text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.restaurants; w public.waiters; tok uuid;
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.plan_has(r.plan, 'mesas') then raise exception 'O app do garçom faz parte do plano Completo'; end if;
  if (select count(*) from public.waiter_attempts where restaurant_id = r.id and not ok and at > now() - interval '10 minutes') >= 15 then
    return jsonb_build_object('error', 'Muitas tentativas erradas. Espere 10 minutos e tente de novo.');
  end if;
  select * into w from public.waiters where restaurant_id = r.id and active and pin_hash = crypt(coalesce(p_pin, ''), pin_hash) limit 1;
  insert into public.waiter_attempts (restaurant_id, ok) values (r.id, w.id is not null);
  -- erro devolvido (não lançado) para a tentativa errada ficar registrada
  if w.id is null then return jsonb_build_object('error', 'PIN incorreto'); end if;
  insert into public.waiter_sessions (waiter_id, restaurant_id) values (w.id, r.id) returning token into tok;
  return jsonb_build_object('token', tok, 'name', w.name, 'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug, 'logo_url', r.logo_url));
end;
$$;
grant execute on function public.waiter_login(text, text) to anon, authenticated;

create or replace function public._waiter(p_token uuid)
returns table (waiter_id bigint, waiter_name text, restaurant_id uuid, slug text)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, r.id, r.slug from public.waiter_sessions s
    join public.waiters w on w.id = s.waiter_id and w.active
    join public.restaurants r on r.id = s.restaurant_id
   where s.token = p_token and s.expires_at > now() and public.plan_has(r.plan, 'mesas');
$$;
revoke execute on function public._waiter(uuid) from public, anon, authenticated;

create or replace function public.waiter_tables(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label,
      'bill', (select jsonb_build_object('id', b.id, 'opened_at', b.opened_at,
                 'total', (select coalesce(sum(o.total), 0) from public.orders o where o.bill_id = b.id and o.status <> 'cancelado'),
                 'orders', (select count(*) from public.orders o where o.bill_id = b.id and o.status <> 'cancelado'),
                 'ready', (select count(*) from public.orders o where o.bill_id = b.id and o.status = 'pronto'))
               from public.table_bills b where b.table_id = t.id and b.closed_at is null))
      order by t.position, t.id)
    from public.dining_tables t where t.restaurant_id = me.restaurant_id and t.active), '[]'::jsonb);
end;
$$;
grant execute on function public.waiter_tables(uuid) to anon, authenticated;

create or replace function public.waiter_order(p_token uuid, p_table bigint, p_items jsonb, p_name text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; tk uuid;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  select token into tk from public.dining_tables where id = p_table and restaurant_id = me.restaurant_id and active;
  if tk is null then raise exception 'Mesa não encontrada'; end if;
  perform set_config('bora.waiter', me.waiter_name, true);
  return public.place_order(me.slug, jsonb_build_object('table', tk::text, 'name', coalesce(p_name, ''), 'notes', coalesce(p_notes, '')), p_items);
end;
$$;
grant execute on function public.waiter_order(uuid, bigint, jsonb, text, text) to anon, authenticated;

create or replace function public.waiter_bill(p_token uuid, p_table bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record; b public.table_bills;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  select * into b from public.table_bills where table_id = p_table and restaurant_id = me.restaurant_id and closed_at is null;
  if not found then return jsonb_build_object('bill', null, 'orders', '[]'::jsonb); end if;
  return jsonb_build_object('bill', to_jsonb(b), 'orders', coalesce((select jsonb_agg(jsonb_build_object('number', o.number, 'status', o.status,
      'items', o.items, 'total', o.total, 'customer_name', o.customer_name, 'waiter', o.waiter, 'created_at', o.created_at) order by o.created_at)
    from public.orders o where o.bill_id = b.id and o.status <> 'cancelado'), '[]'::jsonb));
end;
$$;
grant execute on function public.waiter_bill(uuid, bigint) to anon, authenticated;

create or replace function public.waiter_serve(p_token uuid, p_table bigint)
returns int language plpgsql security definer set search_path = public as $$
declare me record; n int;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  update public.orders o set status = 'entregue' from public.table_bills b
   where o.bill_id = b.id and b.table_id = p_table and b.restaurant_id = me.restaurant_id and b.closed_at is null and o.status = 'pronto';
  get diagnostics n = row_count; return n;
end;
$$;
grant execute on function public.waiter_serve(uuid, bigint) to anon, authenticated;

create or replace function public.waiter_close(p_token uuid, p_table bigint, p_payment text, p_service_pct numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; bid bigint;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  select id into bid from public.table_bills where table_id = p_table and restaurant_id = me.restaurant_id and closed_at is null;
  if bid is null then raise exception 'Esta mesa não tem conta aberta'; end if;
  return public._close_bill(bid, p_payment, p_service_pct, me.waiter_name);
end;
$$;
grant execute on function public.waiter_close(uuid, bigint, text, numeric) to anon, authenticated;

-- ---------- estoque: entrada, ajuste e perda ----------
create or replace function public.stock_adjust(p_item bigint, p_delta numeric, p_reason text, p_note text default null, p_cost numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.stock_items;
begin
  select * into s from public.stock_items where id = p_item for update;
  if not found or not public.owns_feature(s.restaurant_id, 'estoque') then raise exception 'Sem permissão'; end if;
  if p_reason not in ('entrada', 'ajuste', 'perda') then raise exception 'Tipo de movimento inválido'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then raise exception 'Quantidade inválida'; end if;
  update public.stock_items set qty = qty + p_delta, updated_at = now(),
    cost = case when p_reason = 'entrada' and p_cost is not null and p_cost >= 0 then p_cost else cost end
   where id = s.id returning * into s;
  insert into public.stock_moves (restaurant_id, stock_item_id, delta, reason, note) values (s.restaurant_id, s.id, p_delta, p_reason, left(p_note, 120));
  return to_jsonb(s);
end;
$$;
grant execute on function public.stock_adjust(bigint, numeric, text, text, numeric) to authenticated;

-- ---------- financeiro: relatório do período ----------
create or replace function public.finance_report(p_rid uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.owns_feature(p_rid, 'estoque') then raise exception 'Sem permissão'; end if;
  with o as (
    select o.*, coalesce(case when o.mode = 'mesa' then b.payment end, o.payment) pay
      from public.orders o left join public.table_bills b on b.id = o.bill_id
     where o.restaurant_id = p_rid and o.created_at >= p_from and o.created_at < p_to and o.status not in ('pagamento')
  ), ok as (select * from o where status <> 'cancelado'),
  lines as (select (l.v ->> 'product_id')::bigint pid, l.v ->> 'name' name, (l.v ->> 'qty')::numeric qty, (l.v ->> 'price')::numeric * (l.v ->> 'qty')::numeric rev from ok, jsonb_array_elements(ok.items) as l(v)),
  cmv as (select coalesce(sum(li.qty * pr.qty * si.cost), 0) v from lines li join public.product_recipes pr on pr.product_id = li.pid join public.stock_items si on si.id = pr.stock_item_id)
  select jsonb_build_object(
    'orders', (select count(*) from ok),
    'canceled', (select count(*) from o where status = 'cancelado'),
    'gross', (select coalesce(sum(subtotal), 0) from ok),
    'fees', (select coalesce(sum(fee), 0) from ok),
    'discounts', (select coalesce(sum(discount), 0) from ok),
    'total', (select coalesce(sum(total), 0) from ok),
    'service', (select coalesce(sum(service), 0) from public.table_bills where restaurant_id = p_rid and closed_at >= p_from and closed_at < p_to),
    'cmv', (select v from cmv),
    'expenses', (select coalesce(sum(amount), 0) from public.expenses where restaurant_id = p_rid
                   and spent_on >= (p_from at time zone 'America/Sao_Paulo')::date and spent_on < (p_to at time zone 'America/Sao_Paulo')::date),
    'by_payment', coalesce((select jsonb_agg(jsonb_build_object('k', pay, 'n', n, 'v', v) order by v desc) from (select pay, count(*) n, sum(total) v from ok group by pay) x), '[]'::jsonb),
    'by_mode', coalesce((select jsonb_agg(jsonb_build_object('k', mode, 'n', n, 'v', v) order by v desc) from (select mode, count(*) n, sum(total) v from ok group by mode) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n, 'v', v) order by d) from
                (select (created_at at time zone 'America/Sao_Paulo')::date d, count(*) n, sum(total) v from ok group by 1) x), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h) from
                (select extract(hour from created_at at time zone 'America/Sao_Paulo')::int h, count(*) n from ok group by 1) x), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'v', v) order by q desc, v desc) from
                (select name, sum(qty) q, sum(rev) v from lines group by name order by sum(qty) desc, sum(rev) desc limit 10) x), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;
grant execute on function public.finance_report(uuid, timestamptz, timestamptz) to authenticated;

-- ---------- caixa: abrir, movimentar e fechar ----------
create or replace function public._cash_expected(s public.cash_sessions)
returns numeric language sql stable security definer set search_path = public as $$
  select s.opening
    + coalesce((select sum(total) from public.orders where restaurant_id = s.restaurant_id and payment = 'dinheiro'
                  and status not in ('pagamento', 'cancelado') and created_at >= s.opened_at and created_at < coalesce(s.closed_at, now())), 0)
    + coalesce((select sum(total) from public.table_bills where restaurant_id = s.restaurant_id and payment = 'dinheiro'
                  and closed_at >= s.opened_at and closed_at < coalesce(s.closed_at, now())), 0)
    + coalesce((select sum(case kind when 'suprimento' then amount else -amount end) from public.cash_moves where session_id = s.id), 0);
$$;
revoke execute on function public._cash_expected(public.cash_sessions) from public, anon, authenticated;

create or replace function public.cash_status(p_rid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.cash_sessions;
begin
  if not public.owns_feature(p_rid, 'estoque') then raise exception 'Sem permissão'; end if;
  select * into s from public.cash_sessions where restaurant_id = p_rid and closed_at is null;
  return jsonb_build_object(
    'open', case when s.id is null then null else to_jsonb(s) || jsonb_build_object('expected', public._cash_expected(s),
      'moves', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from public.cash_moves m where m.session_id = s.id), '[]'::jsonb)) end,
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.opened_at desc) from
      (select * from public.cash_sessions where restaurant_id = p_rid and closed_at is not null order by opened_at desc limit 10) h), '[]'::jsonb));
end;
$$;
grant execute on function public.cash_status(uuid) to authenticated;

create or replace function public.cash_open(p_rid uuid, p_opening numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.owns_feature(p_rid, 'estoque') then raise exception 'Sem permissão'; end if;
  if exists (select 1 from public.cash_sessions where restaurant_id = p_rid and closed_at is null) then raise exception 'O caixa já está aberto'; end if;
  insert into public.cash_sessions (restaurant_id, opening) values (p_rid, greatest(0, coalesce(p_opening, 0)));
  return public.cash_status(p_rid);
end;
$$;
grant execute on function public.cash_open(uuid, numeric) to authenticated;

create or replace function public.cash_move(p_rid uuid, p_kind text, p_amount numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid bigint;
begin
  if not public.owns_feature(p_rid, 'estoque') then raise exception 'Sem permissão'; end if;
  select id into sid from public.cash_sessions where restaurant_id = p_rid and closed_at is null;
  if sid is null then raise exception 'Abra o caixa primeiro'; end if;
  if p_kind not in ('suprimento', 'sangria') or coalesce(p_amount, 0) <= 0 then raise exception 'Movimento inválido'; end if;
  insert into public.cash_moves (session_id, restaurant_id, kind, amount, note) values (sid, p_rid, p_kind, p_amount, left(p_note, 120));
  return public.cash_status(p_rid);
end;
$$;
grant execute on function public.cash_move(uuid, text, numeric, text) to authenticated;

create or replace function public.cash_close(p_rid uuid, p_counted numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.cash_sessions;
begin
  if not public.owns_feature(p_rid, 'estoque') then raise exception 'Sem permissão'; end if;
  select * into s from public.cash_sessions where restaurant_id = p_rid and closed_at is null for update;
  if not found then raise exception 'O caixa não está aberto'; end if;
  update public.cash_sessions set expected = public._cash_expected(s), closed_at = now(), counted = greatest(0, coalesce(p_counted, 0)), note = left(p_note, 200)
   where id = s.id;
  return public.cash_status(p_rid);
end;
$$;
grant execute on function public.cash_close(uuid, numeric, text) to authenticated;

-- ---------- caixa de entrada: chat do site ----------
create or replace function public.chat_messages_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chat_threads set last_msg_at = now(), unread = case when new.sender = 'cliente' then unread + 1 else 0 end where id = new.thread_id;
  return new;
end;
$$;
create or replace trigger chat_messages_touch after insert on public.chat_messages
for each row execute function public.chat_messages_touch();

create or replace function public.site_chat_fetch(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('sender', m.sender, 'body', m.body, 'at', m.created_at) order by m.created_at)
    from (select * from public.chat_messages where thread_id = t.id order by created_at desc limit 100) m), '[]'::jsonb)
  from public.chat_threads t where t.token = p_token;
$$;
grant execute on function public.site_chat_fetch(uuid) to anon, authenticated;

create or replace function public.site_chat_send(p_slug text, p_token uuid, p_name text, p_phone text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.restaurants; t public.chat_threads; b text := left(trim(coalesce(p_body, '')), 1000);
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found or not public.plan_has(r.plan, 'inbox') then raise exception 'Esta loja não recebe mensagens pelo site'; end if;
  if b = '' then raise exception 'Escreva a mensagem'; end if;
  select * into t from public.chat_threads where token = p_token;
  if found and t.restaurant_id <> r.id then raise exception 'Conversa inválida'; end if;
  if not found then
    if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Informe seu nome'; end if;
    insert into public.chat_threads (restaurant_id, token, name, phone)
    values (r.id, p_token, left(trim(p_name), 80), left(regexp_replace(coalesce(p_phone, ''), '[^0-9()+ -]', '', 'g'), 20)) returning * into t;
  end if;
  if (select count(*) from public.chat_messages where thread_id = t.id and sender = 'cliente' and created_at > now() - interval '1 minute') >= 8 then
    raise exception 'Muitas mensagens seguidas. Espere um pouquinho.';
  end if;
  insert into public.chat_messages (thread_id, restaurant_id, sender, body) values (t.id, r.id, 'cliente', b);
  return public.site_chat_fetch(p_token);
end;
$$;
grant execute on function public.site_chat_send(text, uuid, text, text, text) to anon, authenticated;

create or replace function public.chat_reply(p_thread bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.chat_threads; b text := left(trim(coalesce(p_body, '')), 1000);
begin
  select * into t from public.chat_threads where id = p_thread;
  if not found or not public.owns_feature(t.restaurant_id, 'inbox') then raise exception 'Sem permissão'; end if;
  if b = '' then raise exception 'Escreva a mensagem'; end if;
  insert into public.chat_messages (thread_id, restaurant_id, sender, body) values (t.id, t.restaurant_id, 'loja', b);
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.chat_reply(bigint, text) to authenticated;

-- aviso de status no WhatsApp: só com o robô (Profissional+) e nunca para pedido de mesa
create or replace function public.wa_notify_status()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare b public.whatsapp_bots; s text; pl text;
begin
  if new.status = 'pagamento' or new.mode = 'mesa' then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select plan into pl from public.restaurants where id = new.restaurant_id;
  if not public.plan_has(pl, 'robo') then return new; end if;
  select * into b from public.whatsapp_bots where restaurant_id = new.restaurant_id;
  if not found or not b.enabled or not b.notify_status or b.phone_number_id is null then return new; end if;
  select wa_hook_secret into s from public.platform_secrets where id = 1;
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://bqjzdtsthhcuynokdzik.supabase.co/functions/v1/whatsapp?action=notify',
    body := jsonb_build_object('order_id', new.id, 'status', new.status),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bora-hook', s),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new; -- o aviso nunca pode travar a mudança do pedido
end;
$$;

-- status do pedido para o cliente (com desconto e mesa)
create or replace function public.order_status(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                            'paid', o.paid, 'restaurant', r.name, 'whatsapp', r.whatsapp, 'mode', o.mode, 'discount', o.discount)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.public_id = p_public_id;
$$;
