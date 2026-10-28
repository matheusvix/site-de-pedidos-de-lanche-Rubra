-- ============================================================
-- BoraLanchar! — Etapa 1: Pedidos + Desempenho
--   • Aceitar pedidos automaticamente (restaurants.auto_accept)
--   • Pedido lançado no balcão pelo painel (PDV): owner_place_order
--   • Origem do pedido (orders.source): cardapio, balcao, garcom, qrcode, whatsapp
--   • Pedidos agendados (restaurants.schedule_*; orders.scheduled_for)
-- Rode depois do motoboys.sql. Pode rodar de novo sem problema.
-- ============================================================

alter table public.restaurants add column if not exists auto_accept boolean not null default false;
alter table public.restaurants add column if not exists schedule_enabled boolean not null default false;
alter table public.restaurants add column if not exists schedule_days int not null default 2 check (schedule_days between 0 and 14);
alter table public.restaurants add column if not exists schedule_step int not null default 30 check (schedule_step between 15 and 120);

alter table public.orders add column if not exists source text not null default 'cardapio'
  check (source in ('cardapio', 'balcao', 'garcom', 'qrcode', 'whatsapp', 'instagram'));
alter table public.orders add column if not exists scheduled_for timestamptz;
create index if not exists orders_scheduled on public.orders (restaurant_id, scheduled_for) where scheduled_for is not null;
-- pedido de balcão pode ficar sem telefone
alter table public.orders drop constraint if exists orders_customer_phone_check;
alter table public.orders add constraint orders_customer_phone_check
  check (char_length(customer_phone) <= 20 and (mode = 'mesa' or source = 'balcao' or char_length(customer_phone) >= 8));
-- pedidos antigos de mesa
update public.orders set source = case when waiter is not null then 'garcom' else 'qrcode' end where mode = 'mesa' and source = 'cardapio';

-- ---------- loja aberta num horário qualquer (para o agendamento) ----------
create or replace function public.store_open_at(r public.restaurants, p_at timestamptz)
returns boolean language plpgsql stable set search_path = public as $$
declare
  lt timestamp := p_at at time zone 'America/Sao_Paulo';
  d int := extract(dow from lt)::int;
  t time := lt::time;
  iv jsonb; s time; e time;
begin
  if r.opening_hours is null then return true; end if;
  for iv in select * from jsonb_array_elements(coalesce(r.opening_hours -> d::text, '[]')) loop
    s := (iv ->> 0)::time; e := (iv ->> 1)::time;
    if e > s then
      if t >= s and t < e then return true; end if;
    elsif t >= s then return true;
    end if;
  end loop;
  for iv in select * from jsonb_array_elements(coalesce(r.opening_hours -> ((d + 6) % 7)::text, '[]')) loop
    s := (iv ->> 0)::time; e := (iv ->> 1)::time;
    if e <= s and t < e then return true; end if;
  end loop;
  return false;
end;
$$;

-- ---------- pedido (cardápio, mesa, garçom e balcão) ----------
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
  pdv boolean := coalesce(current_setting('bora.pdv', true), '') = '1';
  sched timestamptz := null;
  src text;
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found then raise exception 'Loja não encontrada'; end if;
  if not public.restaurant_can_sell(r) then raise exception 'Esta loja não está recebendo pedidos no momento'; end if;
  -- pedido agendado: o cliente escolhe dia e horário (a loja precisa ter ativado)
  if not pdv and nullif(p_customer ->> 'scheduled_for', '') is not null and nullif(p_customer ->> 'table', '') is null then
    if not r.schedule_enabled then raise exception 'Esta loja não aceita pedidos agendados'; end if;
    begin sched := (p_customer ->> 'scheduled_for')::timestamptz; exception when others then raise exception 'Horário do agendamento inválido'; end;
    if sched < now() + make_interval(mins => greatest(r.schedule_step, 15)) then raise exception 'Escolha um horário a partir de daqui a % minutos', greatest(r.schedule_step, 15); end if;
    if sched > now() + make_interval(days => greatest(r.schedule_days, 0) + 1) then raise exception 'Escolha uma data mais próxima'; end if;
    if not public.store_open_at(r, sched) then raise exception 'A loja não abre nesse horário. Escolha outro.'; end if;
  elsif not pdv and not public.store_open_now(r) then
    raise exception 'A loja está fechada agora';
  end if;
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
    if pdv then
      if pay not in ('pix', 'cartao', 'dinheiro') then raise exception 'Escolha a forma de pagamento'; end if;
    else
      if m = 'entrega' and not r.accepts_delivery then raise exception 'Esta loja não faz entrega'; end if;
      if m = 'retirada' and not r.accepts_pickup then raise exception 'Esta loja não aceita retirada'; end if;
      if not (pay = any (r.payment_methods)) then raise exception 'Forma de pagamento não aceita por esta loja'; end if;
    end if;
    wname := null;
  end if;
  if cname = '' and pdv then cname := 'Cliente balcão'; end if;
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

  if m <> 'mesa' and not pdv and sub < r.min_order then raise exception 'Pedido mínimo: R$ %', to_char(r.min_order, 'FM999990D00'); end if;

  if m = 'entrega' and pdv then
    fee := greatest(0, least(999, coalesce(nullif(p_customer ->> 'fee', '')::numeric, r.delivery_fee, 0)));
    info := 'Lançado no balcão';
  elsif m = 'retirada' and pdv then
    info := 'Lançado no balcão';
  elsif m = 'entrega' then
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
  if pdv then
    disc := greatest(0, coalesce(nullif(p_customer ->> 'discount', '')::numeric, 0));
  elsif m <> 'mesa' and public.plan_has(r.plan, 'cupons') then
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

  st := case when pdv then 'novo' when m <> 'mesa' and pay = 'pix' and r.pix_key is not null and sub + fee - disc > 0 then 'pagamento' else 'novo' end;
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

  src := case when pdv then 'balcao' when m = 'mesa' and wname is not null then 'garcom' when m = 'mesa' then 'qrcode'
              when p_customer ->> 'source' in ('whatsapp', 'instagram') then p_customer ->> 'source' else 'cardapio' end;
  if sched is not null then info := left(coalesce(info || ' · ', '') || 'Agendado', 120); end if;
  insert into public.orders (restaurant_id, number, customer_name, customer_phone, mode, address, payment, change_for, notes,
                             items, subtotal, fee, discount, total, delivery_info, geo, status, coupon_code, reward_used, table_id, bill_id, waiter,
                             source, scheduled_for, paid)
  values (r.id, num,
          cname,
          left(regexp_replace(coalesce(p_customer ->> 'phone', ''), '[^0-9()+ -]', '', 'g'), 20),
          m,
          case when m = 'entrega' then left(p_customer ->> 'address', 300) end,
          pay,
          case when m <> 'mesa' then nullif(p_customer ->> 'change_for', '')::numeric end,
          left(p_customer ->> 'notes', 300),
          lines, sub, fee, disc, sub + fee - disc, info, geo, st, ccode, rew, tb.id, bill_id, left(wname, 60),
          src, sched, pdv and coalesce(p_customer ->> 'paid', '') = 'true')
  returning * into ord;

  if cid is not null then
    perform set_config('bora.sys', '1', true);
    update public.coupons set uses = uses + 1 where id = cid;
    insert into public.coupon_uses (coupon_id, restaurant_id, phone, order_id) values (cid, r.id, public.bora_phone(p_customer ->> 'phone'), ord.id);
    perform set_config('bora.sys', '', true);
  end if;

  return jsonb_build_object('public_id', ord.public_id, 'number', ord.number, 'total', ord.total, 'subtotal', ord.subtotal,
    'fee', ord.fee, 'discount', ord.discount, 'coupon', ord.coupon_code, 'items', ord.items, 'whatsapp', r.whatsapp, 'restaurant', r.name,
    'delivery_info', ord.delivery_info, 'pix_key', r.pix_key, 'status', ord.status, 'mode', ord.mode, 'scheduled_for', ord.scheduled_for);
end;
$$;
grant execute on function public.place_order(text, jsonb, jsonb) to anon, authenticated;

-- ---------- PDV: o dono lança o pedido pelo painel ----------
create or replace function public.owner_place_order(p_rid uuid, p_customer jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s text; res jsonb;
begin
  if not (public.owns_restaurant(p_rid) or public.is_admin()) then raise exception 'Sem permissão'; end if;
  select slug into s from public.restaurants where id = p_rid;
  perform set_config('bora.pdv', '1', true);
  res := public.place_order(s, (p_customer - 'table' - 'scheduled_for' - 'coupon' - 'use_reward'), p_items);
  perform set_config('bora.pdv', '', true);
  return res;
end;
$$;
revoke execute on function public.owner_place_order(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.owner_place_order(uuid, jsonb, jsonb) to authenticated;

-- ---------- aceitar pedidos automaticamente ----------
create or replace function public.orders_auto_accept()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.status = 'novo' and new.number > 0 and new.scheduled_for is null
     and (tg_op = 'INSERT' or old.status is distinct from 'novo')
     and exists (select 1 from public.restaurants r where r.id = new.restaurant_id and r.auto_accept) then
    update public.orders set status = 'preparo' where id = new.id and status = 'novo';
  end if;
  return null;
end;
$$;
create or replace trigger orders_auto_accept after insert or update of status on public.orders
for each row execute function public.orders_auto_accept();

-- ---------- status para o cliente (com agendamento e motoboy) ----------
create or replace function public.order_status(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                            'paid', o.paid, 'restaurant', r.name, 'whatsapp', r.whatsapp, 'mode', o.mode, 'discount', o.discount,
                            'scheduled_for', o.scheduled_for)
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

-- ---------- Desempenho (aba do painel, todos os planos) ----------
create or replace function public.performance_report(p_rid uuid, p_days int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d int := greatest(1, least(coalesce(p_days, 7), 90));
  t0 timestamptz := now() - make_interval(days => d);
  tp timestamptz := now() - make_interval(days => 2 * d);
  today timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
begin
  if not (public.owns_restaurant(p_rid) or public.is_admin()) then raise exception 'Sem permissão'; end if;
  return (
    with base as (
      select o.total, o.mode, o.source, o.created_at, o.status,
             (o.created_at at time zone 'America/Sao_Paulo') lt
        from public.orders o
       where o.restaurant_id = p_rid and o.created_at >= least(tp, today) and o.number > 0 and o.status <> 'pagamento'
    ), ok as (select * from base where status <> 'cancelado')
    select jsonb_build_object(
      'cur', (select jsonb_build_object('total', coalesce(sum(total), 0), 'orders', count(*)) from ok where created_at >= t0),
      'prev', (select jsonb_build_object('total', coalesce(sum(total), 0), 'orders', count(*)) from ok where created_at >= tp and created_at < t0),
      'today', (select jsonb_build_object('total', coalesce(sum(total), 0), 'orders', count(*)) from ok where created_at >= today),
      'canceled', (select count(*) from base where status = 'cancelado' and created_at >= t0),
      'by_mode', coalesce((select jsonb_agg(jsonb_build_object('k', mode, 'n', n, 'v', v) order by v desc)
                    from (select mode, count(*) n, sum(total) v from ok where created_at >= t0 group by mode) x), '[]'::jsonb),
      'by_source', coalesce((select jsonb_agg(jsonb_build_object('k', source, 'n', n, 'v', v) order by v desc)
                    from (select source, count(*) n, sum(total) v from ok where created_at >= t0 group by source) x), '[]'::jsonb),
      'by_hour', coalesce((select jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h)
                    from (select extract(hour from lt)::int h, count(*) n from ok where created_at >= t0 group by 1) x), '[]'::jsonb),
      'by_weekday', coalesce((select jsonb_agg(jsonb_build_object('d', wd, 'n', n, 'v', v) order by wd)
                    from (select extract(dow from lt)::int wd, count(*) n, sum(total) v from ok where created_at >= t0 group by 1) x), '[]'::jsonb),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', dd, 'n', n, 'v', v) order by dd)
                    from (select to_char(lt, 'YYYY-MM-DD') dd, count(*) n, sum(total) v from ok where created_at >= t0 group by 1) x), '[]'::jsonb)
    ));
end;
$$;
revoke execute on function public.performance_report(uuid, int) from public, anon;
grant execute on function public.performance_report(uuid, int) to authenticated;
