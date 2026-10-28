-- ============================================================
-- BoraLanchar! — Etapa 2: Cardápio e Relatórios
--   • Produto: preço promocional, destaque e dias da semana
--   • Loja: observação do pedido liga/desliga, pergunta de descartáveis
--   • Funil do cardápio (visitas → produto → sacola → finalização → pedido)
--   • Relatórios (clientes, itens, entregas, garçons, cupons, bairros, horários)
-- Rode depois do etapa1-pedidos.sql. Pode rodar de novo sem problema.
-- ============================================================

alter table public.products add column if not exists promo_price numeric(10,2) check (promo_price >= 0);
alter table public.products add column if not exists featured boolean not null default false;
alter table public.products add column if not exists days smallint[] check (days <@ array[0,1,2,3,4,5,6]::smallint[]);
alter table public.restaurants add column if not exists allow_notes boolean not null default true;
alter table public.restaurants add column if not exists ask_cutlery boolean not null default false;

-- ---------- funil do cardápio ----------
create table if not exists public.menu_stats (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day date not null,
  visits int not null default 0,
  views int not null default 0,
  carts int not null default 0,
  checkouts int not null default 0,
  primary key (restaurant_id, day)
);
alter table public.menu_stats enable row level security;
do $$ begin
  drop policy if exists "dono le funil" on public.menu_stats;
  create policy "dono le funil" on public.menu_stats for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin());
end $$;
revoke insert, update, delete on public.menu_stats from anon, authenticated;

create or replace function public.track_event(p_slug text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid; d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_kind not in ('visit', 'view', 'cart', 'checkout') then return; end if;
  select id into rid from public.restaurants where slug = lower(p_slug);
  if rid is null then return; end if;
  insert into public.menu_stats as m (restaurant_id, day, visits, views, carts, checkouts)
  values (rid, d, (p_kind = 'visit')::int, (p_kind = 'view')::int, (p_kind = 'cart')::int, (p_kind = 'checkout')::int)
  on conflict (restaurant_id, day) do update set
    visits = m.visits + (p_kind = 'visit')::int, views = m.views + (p_kind = 'view')::int,
    carts = m.carts + (p_kind = 'cart')::int, checkouts = m.checkouts + (p_kind = 'checkout')::int;
end;
$$;
grant execute on function public.track_event(text, text) to anon, authenticated;

-- ---------- pedido: preço promocional e dias da semana ----------
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
    if p.days is not null and not (extract(dow from (coalesce(sched, now()) at time zone 'America/Sao_Paulo'))::smallint = any (p.days)) then
      raise exception '"%" não está disponível nesse dia', p.name;
    end if;
    sel := coalesce(it -> 'options', '[]'::jsonb);
    if jsonb_typeof(sel) <> 'array' then sel := '[]'::jsonb; end if;
    unit := case when p.promo_price is not null and p.promo_price < p.price then p.promo_price else p.price end; opts := '[]'::jsonb;
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

-- ---------- relatórios ----------
create or replace function public.reports_data(p_rid uuid, p_days int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d int := greatest(1, least(coalesce(p_days, 30), 365));
  t0 timestamptz := now() - make_interval(days => d);
begin
  if not (public.owns_restaurant(p_rid) or public.is_admin()) then raise exception 'Sem permissão'; end if;
  return (
    with ok as (
      select o.* from public.orders o
       where o.restaurant_id = p_rid and o.number > 0 and o.status not in ('pagamento', 'cancelado')
    ), per as (select * from ok where created_at >= t0),
    cli as (
      select public.bora_phone(customer_phone) ph,
             (array_agg(customer_name order by created_at desc))[1] nm,
             count(*) n, sum(total) v, max(created_at) last_at, min(created_at) first_at
        from ok where public.bora_phone(customer_phone) is not null group by 1
    ), pot as (
      select public.bora_phone(o.customer_phone) ph, (array_agg(o.customer_name order by o.created_at desc))[1] nm, max(o.created_at) last_at
        from public.orders o
       where o.restaurant_id = p_rid and o.created_at >= t0 and (o.status = 'pagamento' or (o.status = 'cancelado' and o.number = 0))
         and public.bora_phone(o.customer_phone) is not null
         and not exists (select 1 from cli where cli.ph = public.bora_phone(o.customer_phone))
       group by 1
    )
    select jsonb_build_object(
      'clients', coalesce((select jsonb_agg(jsonb_build_object('phone', ph, 'name', nm, 'orders', n, 'total', v, 'last', last_at, 'first', first_at) order by v desc)
                           from (select * from cli order by v desc limit 1000) x), '[]'::jsonb),
      'potential', coalesce((select jsonb_agg(jsonb_build_object('phone', ph, 'name', nm, 'last', last_at) order by last_at desc) from pot), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', nm, 'qty', q, 'v', v) order by q desc)
                         from (select i ->> 'name' nm, sum((i ->> 'qty')::int) q, sum((i ->> 'qty')::int * (i ->> 'price')::numeric) v
                                 from per, jsonb_array_elements(per.items) i group by 1 order by 2 desc limit 50) x), '[]'::jsonb),
      'couriers', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(c.name, 'Sem motoboy'), 'n', x.n, 'fees', x.f, 'v', x.v, 'mins', x.mins) order by x.n desc)
                         from (select courier_id, count(*) n, sum(fee) f, sum(total) v,
                                      round(avg(extract(epoch from (coalesce(out_at, created_at) - created_at)) / 60) filter (where out_at is not null)) mins
                                 from per where mode = 'entrega' and status in ('saiu', 'entregue') group by 1) x
                         left join public.couriers c on c.id = x.courier_id), '[]'::jsonb),
      'waiters', coalesce((select jsonb_agg(jsonb_build_object('name', waiter, 'n', n, 'v', v) order by v desc)
                         from (select waiter, count(*) n, sum(total) v from per where waiter is not null group by 1) x), '[]'::jsonb),
      'zones', coalesce((select jsonb_agg(jsonb_build_object('name', z, 'n', n, 'v', v, 'fees', f) order by n desc)
                         from (select coalesce(nullif(split_part(delivery_info, ' · ', 1), ''), 'Sem bairro') z, count(*) n, sum(total) v, sum(fee) f
                                 from per where mode = 'entrega' group by 1) x), '[]'::jsonb),
      'coupons', coalesce((select jsonb_agg(jsonb_build_object('code', coupon_code, 'n', n, 'disc', ds, 'v', v) order by n desc)
                         from (select coupon_code, count(*) n, sum(discount) ds, sum(total) v from per where coupon_code is not null group by 1) x), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(jsonb_build_object('k', payment, 'n', n, 'v', v) order by v desc)
                         from (select payment, count(*) n, sum(total) v from per group by 1) x), '[]'::jsonb),
      'tickets', (select jsonb_build_object('avg', coalesce(avg(total), 0), 'min', coalesce(min(total), 0), 'max', coalesce(max(total), 0),
                         'items_avg', coalesce(avg((select sum((i ->> 'qty')::int) from jsonb_array_elements(items) i)), 0),
                         'fees', coalesce(sum(fee), 0), 'discounts', coalesce(sum(discount), 0), 'total', coalesce(sum(total), 0), 'orders', count(*)) from per),
      'funnel', (select jsonb_build_object('visits', coalesce(sum(visits), 0), 'views', coalesce(sum(views), 0), 'carts', coalesce(sum(carts), 0),
                         'checkouts', coalesce(sum(checkouts), 0),
                         'orders', (select count(*) from per where source = 'cardapio'))
                   from public.menu_stats where restaurant_id = p_rid and day >= (t0 at time zone 'America/Sao_Paulo')::date)
    ));
end;
$$;
revoke execute on function public.reports_data(uuid, int) from public, anon;
grant execute on function public.reports_data(uuid, int) to authenticated;
