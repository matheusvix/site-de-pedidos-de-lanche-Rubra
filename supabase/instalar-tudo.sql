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
