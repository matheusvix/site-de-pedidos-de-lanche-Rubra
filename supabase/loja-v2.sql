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
