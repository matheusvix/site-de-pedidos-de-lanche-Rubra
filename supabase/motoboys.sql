-- ============================================================
-- BoraLanchar! — Motoboys e entrega em tempo real (planos Profissional e Completo)
--   • O dono cadastra os motoboys (nome, WhatsApp e PIN) na aba "Entregas" do painel.
--   • O motoboy usa /motoboy.html?loja=<link-da-loja>: entra com o PIN, pega a entrega,
--     toca em "Saí para entrega" e o celular dele passa a mandar a localização.
--   • O cliente vê o motoboy andando no mapa na tela "Acompanhe seu pedido".
-- Rode depois do recursos-planos.sql. Pode rodar de novo sem problema.
-- ============================================================

-- ---------- 1. Plano → recursos (entregas entra no Profissional) ----------
create or replace function public.plan_has(p_plan text, p_feature text)
returns boolean language sql immutable as $$
  select case
    when p_feature in ('robo', 'inbox', 'cupons', 'entregas') then coalesce(p_plan, '') in ('Profissional', 'Completo')
    when p_feature in ('mesas', 'estoque', 'prioritario') then coalesce(p_plan, '') = 'Completo'
    else true end;
$$;
grant execute on function public.plan_has(text, text) to anon, authenticated;

-- ---------- 2. Tabelas ----------
create table if not exists public.couriers (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  phone text check (char_length(phone) <= 20),
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists couriers_rest on public.couriers (restaurant_id);
alter table public.couriers enable row level security;

create table if not exists public.courier_sessions (
  token uuid primary key default gen_random_uuid(),
  courier_id bigint not null references public.couriers (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '16 hours'
);
alter table public.courier_sessions enable row level security;

create table if not exists public.courier_attempts (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  ok boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists courier_attempts_idx on public.courier_attempts (restaurant_id, at desc);
alter table public.courier_attempts enable row level security;

-- última posição de cada motoboy (só existe enquanto ele está em entrega)
create table if not exists public.courier_positions (
  courier_id bigint primary key references public.couriers (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real,
  heading real,
  speed real,
  at timestamptz not null default now()
);
create index if not exists courier_positions_rest on public.courier_positions (restaurant_id);
alter table public.courier_positions enable row level security;

alter table public.orders add column if not exists courier_id bigint references public.couriers (id) on delete set null;
alter table public.orders add column if not exists out_at timestamptz;
create index if not exists orders_courier on public.orders (courier_id) where courier_id is not null;

-- ---------- 3. Quem vê o quê ----------
do $$ begin
  drop policy if exists "dono le couriers" on public.couriers;
  create policy "dono le couriers" on public.couriers for select to authenticated
    using (public.owns_restaurant(restaurant_id) or public.is_admin());
  drop policy if exists "dono apaga couriers" on public.couriers;
  create policy "dono apaga couriers" on public.couriers for delete to authenticated
    using (public.owns_restaurant(restaurant_id) or public.is_admin());
  drop policy if exists "dono le posicoes" on public.courier_positions;
  create policy "dono le posicoes" on public.courier_positions for select to authenticated
    using (public.owns_restaurant(restaurant_id) or public.is_admin());
  begin alter publication supabase_realtime add table public.courier_positions; exception when duplicate_object then null; when undefined_object then null; end;
end $$;
-- o PIN nunca sai do banco
revoke all on public.couriers from anon, authenticated;
grant select (id, restaurant_id, name, phone, active, created_at), delete on public.couriers to authenticated;
revoke all on public.courier_sessions, public.courier_attempts from anon, authenticated;
revoke insert, update, delete on public.courier_positions from anon, authenticated;
revoke all on public.courier_positions from anon;

-- o motoboy do pedido precisa ser da mesma loja
create or replace function public.orders_courier_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.courier_id is not null and not exists (
       select 1 from public.couriers c where c.id = new.courier_id and c.restaurant_id = new.restaurant_id) then
    raise exception 'Motoboy não encontrado nesta loja';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_courier_guard on public.orders;
create trigger orders_courier_guard before update of courier_id on public.orders
for each row execute function public.orders_courier_guard();

-- hora em que saiu para entrega (quando o próprio dono marca no painel)
create or replace function public.orders_out_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'saiu' and old.status is distinct from 'saiu' then new.out_at := coalesce(new.out_at, now()); end if;
  return new;
end;
$$;
drop trigger if exists orders_out_at on public.orders;
create trigger orders_out_at before update of status on public.orders
for each row execute function public.orders_out_at();

-- quando a entrega termina, apaga a posição do motoboy se ele não tem outra em andamento
create or replace function public.orders_courier_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.courier_id is not null and new.status in ('entregue', 'cancelado') and old.status is distinct from new.status
     and not exists (select 1 from public.orders o where o.courier_id = old.courier_id and o.status = 'saiu' and o.id <> new.id) then
    delete from public.courier_positions where courier_id = old.courier_id;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_courier_after on public.orders;
create trigger orders_courier_after after update of status on public.orders
for each row execute function public.orders_courier_after();

-- ---------- 4. Dono: cadastrar motoboy com PIN ----------
create or replace function public.courier_save(p_rid uuid, p_id bigint, p_name text, p_phone text, p_pin text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c public.couriers; ph text := nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+() -]', '', 'g'), 20), '');
begin
  if not public.owns_feature(p_rid, 'entregas') then raise exception 'Sem permissão'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do motoboy'; end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,6}$' then raise exception 'O PIN precisa ter de 4 a 6 números'; end if;
  if p_id is null then
    if p_pin is null then raise exception 'Crie um PIN para o motoboy'; end if;
    insert into public.couriers (restaurant_id, name, phone, pin_hash, active)
    values (p_rid, left(trim(p_name), 40), ph, crypt(p_pin, gen_salt('bf', 8)), coalesce(p_active, true)) returning * into c;
  else
    update public.couriers set name = left(trim(p_name), 40), phone = ph, active = coalesce(p_active, active),
      pin_hash = case when p_pin is null then pin_hash else crypt(p_pin, gen_salt('bf', 8)) end
     where id = p_id and restaurant_id = p_rid returning * into c;
    if not found then raise exception 'Motoboy não encontrado'; end if;
    if not c.active or p_pin is not null then update public.courier_sessions set expires_at = now() where courier_id = c.id; end if;
  end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'active', c.active);
end;
$$;
grant execute on function public.courier_save(uuid, bigint, text, text, text, boolean) to authenticated;

-- ---------- 5. Motoboy: entrar com o PIN ----------
create or replace function public.courier_login(p_slug text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.restaurants; c public.couriers; tok uuid;
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.plan_has(r.plan, 'entregas') then raise exception 'O app do motoboy faz parte do plano Profissional'; end if;
  if (select count(*) from public.courier_attempts where restaurant_id = r.id and not ok and at > now() - interval '10 minutes') >= 15 then
    return jsonb_build_object('error', 'Muitas tentativas erradas. Espere 10 minutos e tente de novo.');
  end if;
  select * into c from public.couriers where restaurant_id = r.id and active and pin_hash = crypt(coalesce(p_pin, ''), pin_hash) limit 1;
  insert into public.courier_attempts (restaurant_id, ok) values (r.id, c.id is not null);
  if c.id is null then return jsonb_build_object('error', 'PIN incorreto'); end if;
  insert into public.courier_sessions (courier_id, restaurant_id) values (c.id, r.id) returning token into tok;
  return jsonb_build_object('token', tok, 'name', c.name,
    'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug, 'logo_url', r.logo_url, 'lat', r.lat, 'lng', r.lng, 'address', r.address));
end;
$$;
grant execute on function public.courier_login(text, text) to anon, authenticated;

create or replace function public._courier(p_token uuid)
returns table (courier_id bigint, courier_name text, restaurant_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, r.id from public.courier_sessions s
    join public.couriers c on c.id = s.courier_id and c.active
    join public.restaurants r on r.id = s.restaurant_id
   where s.token = p_token and s.expires_at > now() and public.plan_has(r.plan, 'entregas');
$$;
revoke execute on function public._courier(uuid) from public, anon, authenticated;

create or replace function public._courier_order(o public.orders)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'customer_name', o.customer_name,
    'customer_phone', o.customer_phone, 'address', o.address, 'geo', o.geo, 'notes', o.notes, 'payment', o.payment,
    'change_for', o.change_for, 'paid', o.paid, 'total', o.total, 'fee', o.fee, 'delivery_info', o.delivery_info,
    'items', (select coalesce(sum((i ->> 'qty')::int), 0) from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) i),
    'created_at', o.created_at, 'out_at', o.out_at, 'mine', o.courier_id is not null);
$$;
revoke execute on function public._courier_order(public.orders) from public, anon, authenticated;

-- minhas entregas + entregas sem motoboy
create or replace function public.courier_orders(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._courier(p_token);
  if me.courier_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  return jsonb_build_object(
    'mine', coalesce((select jsonb_agg(public._courier_order(o) order by (o.status = 'saiu') desc, o.created_at)
                        from public.orders o where o.restaurant_id = me.restaurant_id and o.courier_id = me.courier_id
                         and o.status in ('novo', 'preparo', 'pronto', 'saiu')), '[]'::jsonb),
    'free', coalesce((select jsonb_agg(public._courier_order(o) order by o.created_at)
                        from public.orders o where o.restaurant_id = me.restaurant_id and o.courier_id is null and o.mode = 'entrega'
                         and o.status in ('preparo', 'pronto') and o.created_at > now() - interval '1 day'), '[]'::jsonb),
    'done_today', (select count(*) from public.orders o where o.restaurant_id = me.restaurant_id and o.courier_id = me.courier_id
                         and o.status = 'entregue' and o.created_at > date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'));
end;
$$;
grant execute on function public.courier_orders(uuid) to anon, authenticated;

-- pegar / largar / sair / entregar
create or replace function public.courier_action(p_token uuid, p_order bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; o public.orders;
begin
  select * into me from public._courier(p_token);
  if me.courier_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  select * into o from public.orders where id = p_order and restaurant_id = me.restaurant_id and mode = 'entrega' for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.courier_id is not null and o.courier_id <> me.courier_id then raise exception 'Outro motoboy já pegou esta entrega'; end if;
  if p_action = 'pegar' then
    if o.status not in ('preparo', 'pronto') then raise exception 'Esta entrega não está mais disponível'; end if;
    update public.orders set courier_id = me.courier_id where id = o.id;
  elsif p_action = 'largar' then
    if o.status = 'saiu' then raise exception 'A entrega já saiu. Fale com a loja para trocar de motoboy.'; end if;
    update public.orders set courier_id = null where id = o.id;
  elsif p_action = 'sair' then
    if o.status not in ('preparo', 'pronto', 'saiu') then raise exception 'Este pedido não pode sair para entrega agora'; end if;
    update public.orders set courier_id = me.courier_id, status = 'saiu', out_at = coalesce(out_at, now()) where id = o.id;
  elsif p_action = 'entregue' then
    if o.status <> 'saiu' then raise exception 'Toque em "Saí para entrega" antes'; end if;
    update public.orders set status = 'entregue' where id = o.id;
  else
    raise exception 'Ação inválida';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.courier_action(uuid, bigint, text) to anon, authenticated;

-- localização do celular do motoboy (só grava enquanto ele tem entrega em rota)
create or replace function public.courier_ping(p_token uuid, p_lat double precision, p_lng double precision,
  p_accuracy real default null, p_heading real default null, p_speed real default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._courier(p_token);
  if me.courier_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Localização inválida'; end if;
  if not exists (select 1 from public.orders where courier_id = me.courier_id and status = 'saiu') then
    delete from public.courier_positions where courier_id = me.courier_id;
    return jsonb_build_object('ok', false, 'reason', 'sem entrega em rota');
  end if;
  insert into public.courier_positions as p (courier_id, restaurant_id, lat, lng, accuracy, heading, speed, at)
  values (me.courier_id, me.restaurant_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, now())
  on conflict (courier_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
    heading = excluded.heading, speed = excluded.speed, at = excluded.at
  where p.at < now() - interval '2 seconds';
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.courier_ping(uuid, double precision, double precision, real, real, real) to anon, authenticated;

create or replace function public.courier_logout(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._courier(p_token);
  update public.courier_sessions set expires_at = now() where token = p_token;
  if me.courier_id is not null and not exists (select 1 from public.orders where courier_id = me.courier_id and status = 'saiu') then
    delete from public.courier_positions where courier_id = me.courier_id;
  end if;
end;
$$;
grant execute on function public.courier_logout(uuid) to anon, authenticated;

-- ---------- 6. Cliente: status do pedido com o motoboy no mapa ----------
create or replace function public.order_status(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                            'paid', o.paid, 'restaurant', r.name, 'whatsapp', r.whatsapp, 'mode', o.mode, 'discount', o.discount)
    || case when o.mode = 'entrega' and o.status = 'saiu' then jsonb_build_object(
         'out_at', o.out_at,
         'dest', o.geo,
         'store', case when r.lat is not null then jsonb_build_object('lat', r.lat, 'lng', r.lng) end,
         'courier', case when c.id is not null then jsonb_build_object(
            'name', split_part(c.name, ' ', 1),
            'lat', p.lat, 'lng', p.lng, 'heading', p.heading, 'at', p.at) end)
       else '{}'::jsonb end
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.couriers c on c.id = o.courier_id
  left join public.courier_positions p on p.courier_id = o.courier_id and p.at > now() - interval '15 minutes'
  where o.public_id = p_public_id;
$$;
grant execute on function public.order_status(uuid) to anon, authenticated;

-- limpeza: sessões e tentativas velhas
delete from public.courier_sessions where expires_at < now() - interval '7 days';
delete from public.courier_attempts where at < now() - interval '1 day';
