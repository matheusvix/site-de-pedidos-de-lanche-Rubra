-- ============================================================
-- BoraLanchar! — Etapa 4 (salão): comandas, taxa de serviço configurável e couvert
-- Rode depois do etapa3-marketing.sql. Pode rodar de novo sem problema.
-- ============================================================

alter table public.restaurants add column if not exists service_pct numeric(4,1) not null default 10 check (service_pct between 0 and 20);
alter table public.restaurants add column if not exists couvert numeric(8,2) not null default 0 check (couvert between 0 and 500);
alter table public.dining_tables add column if not exists kind text not null default 'mesa' check (kind in ('mesa', 'comanda'));
alter table public.table_bills add column if not exists people int not null default 1 check (people between 0 and 99);
alter table public.table_bills add column if not exists couvert numeric(10,2) not null default 0;
alter table public.table_bills add column if not exists customer_name text check (char_length(customer_name) <= 80);
alter table public.table_bills add column if not exists customer_cpf text check (char_length(customer_cpf) <= 14);
alter table public.table_bills add column if not exists mesa_id bigint references public.dining_tables (id) on delete set null;

-- QR Code da mesa/comanda: devolve o tipo
create or replace function public.table_info(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.dining_tables;
begin
  if coalesce(p_token, '') !~* '^[0-9a-f-]{36}$' then return null; end if;
  select d.* into t from public.dining_tables d join public.restaurants r on r.id = d.restaurant_id
   where d.token = p_token::uuid and r.slug = lower(p_slug) and d.active and public.plan_has(r.plan, 'mesas');
  if not found then return null; end if;
  return jsonb_build_object('id', t.id, 'label', t.label, 'kind', t.kind);
end;
$$;
grant execute on function public.table_info(text, text) to anon, authenticated;

-- abrir conta (comanda na entrada, com nome/CPF/pessoas)
create or replace function public._open_bill(p_table bigint, p_rid uuid, p_name text, p_cpf text, p_people int, p_mesa bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.dining_tables; b public.table_bills;
begin
  select * into t from public.dining_tables where id = p_table and restaurant_id = p_rid and active;
  if not found then raise exception 'Mesa ou comanda não encontrada'; end if;
  perform pg_advisory_xact_lock(hashtext('mesa' || t.id::text));
  select * into b from public.table_bills where table_id = t.id and closed_at is null;
  if found then
    update public.table_bills set customer_name = coalesce(nullif(left(trim(p_name), 80), ''), customer_name),
      customer_cpf = coalesce(nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''), customer_cpf),
      people = coalesce(p_people, people), mesa_id = coalesce(p_mesa, mesa_id)
     where id = b.id returning * into b;
  else
    insert into public.table_bills (restaurant_id, table_id, customer_name, customer_cpf, people, mesa_id)
    values (p_rid, t.id, nullif(left(trim(coalesce(p_name, '')), 80), ''), nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), ''),
            greatest(0, least(coalesce(p_people, 1), 99)),
            (select id from public.dining_tables where id = p_mesa and restaurant_id = p_rid and kind = 'mesa'))
    returning * into b;
  end if;
  return to_jsonb(b);
end;
$$;
revoke execute on function public._open_bill(bigint, uuid, text, text, int, bigint) from public, anon, authenticated;

create or replace function public.waiter_open_bill(p_token uuid, p_table bigint, p_name text default null, p_cpf text default null, p_people int default 1, p_mesa bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  return public._open_bill(p_table, me.restaurant_id, p_name, p_cpf, p_people, p_mesa);
end;
$$;
grant execute on function public.waiter_open_bill(uuid, bigint, text, text, int, bigint) to anon, authenticated;

create or replace function public.owner_open_bill(p_table bigint, p_name text default null, p_cpf text default null, p_people int default 1, p_mesa bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.dining_tables where id = p_table;
  if rid is null or not public.owns_feature(rid, 'mesas') then raise exception 'Sem permissão'; end if;
  return public._open_bill(p_table, rid, p_name, p_cpf, p_people, p_mesa);
end;
$$;
grant execute on function public.owner_open_bill(bigint, text, text, int, bigint) to authenticated;

-- fechar a conta com serviço (até 20%) e couvert por pessoa
create or replace function public._close_bill2(p_bill bigint, p_payment text, p_service_pct numeric, p_by text, p_people int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.table_bills; r public.restaurants; s numeric(10,2); sv numeric(10,2); cv numeric(10,2); pp int;
begin
  select * into b from public.table_bills where id = p_bill for update;
  if not found or b.closed_at is not null then raise exception 'Esta conta já foi fechada'; end if;
  if p_payment not in ('pix', 'cartao', 'dinheiro') then raise exception 'Escolha a forma de pagamento'; end if;
  select * into r from public.restaurants where id = b.restaurant_id;
  select coalesce(sum(total), 0) into s from public.orders where bill_id = b.id and status <> 'cancelado';
  sv := round(s * greatest(0, least(coalesce(p_service_pct, 0), 20)) / 100, 2);
  pp := greatest(0, least(coalesce(p_people, b.people, 1), 99));
  cv := round(coalesce(r.couvert, 0) * pp, 2);
  update public.table_bills set closed_at = now(), subtotal = s, service = sv, couvert = cv, people = pp, total = s + sv + cv,
         payment = p_payment, closed_by = left(p_by, 60)
   where id = b.id returning * into b;
  update public.orders set paid = true where bill_id = b.id and status <> 'cancelado';
  update public.orders set status = 'entregue' where bill_id = b.id and status in ('novo', 'preparo', 'pronto');
  return to_jsonb(b);
end;
$$;
revoke execute on function public._close_bill2(bigint, text, numeric, text, int) from public, anon, authenticated;

create or replace function public.owner_close_bill2(p_bill bigint, p_payment text, p_service_pct numeric default 0, p_people int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.table_bills where id = p_bill;
  if rid is null or not public.owns_feature(rid, 'mesas') then raise exception 'Sem permissão'; end if;
  return public._close_bill2(p_bill, p_payment, p_service_pct, 'Caixa', p_people);
end;
$$;
grant execute on function public.owner_close_bill2(bigint, text, numeric, int) to authenticated;

create or replace function public.waiter_close2(p_token uuid, p_table bigint, p_payment text, p_service_pct numeric default 0, p_people int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; bid bigint;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  select id into bid from public.table_bills where table_id = p_table and restaurant_id = me.restaurant_id and closed_at is null;
  if bid is null then raise exception 'Esta mesa não tem conta aberta'; end if;
  return public._close_bill2(bid, p_payment, p_service_pct, me.waiter_name, p_people);
end;
$$;
grant execute on function public.waiter_close2(uuid, bigint, text, numeric, int) to anon, authenticated;

-- mesas e comandas para o app do garçom
create or replace function public.waiter_tables(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'kind', t.kind,
      'bill', (select jsonb_build_object('id', b.id, 'opened_at', b.opened_at, 'name', b.customer_name, 'people', b.people,
                 'mesa', (select m.label from public.dining_tables m where m.id = b.mesa_id),
                 'total', (select coalesce(sum(o.total), 0) from public.orders o where o.bill_id = b.id and o.status <> 'cancelado'),
                 'orders', (select count(*) from public.orders o where o.bill_id = b.id and o.status <> 'cancelado'),
                 'ready', (select count(*) from public.orders o where o.bill_id = b.id and o.status = 'pronto'))
               from public.table_bills b where b.table_id = t.id and b.closed_at is null))
      order by t.kind, t.position, t.id)
    from public.dining_tables t where t.restaurant_id = me.restaurant_id and t.active), '[]'::jsonb);
end;
$$;
grant execute on function public.waiter_tables(uuid) to anon, authenticated;

-- pedido da comanda aparece como "Comanda X"
do $$
declare d text := pg_get_functiondef('public.place_order(text,jsonb,jsonb)'::regprocedure);
begin
  if position('tb.kind' in d) > 0 then return; end if;
  d := replace(d, $a$if cname = '' then cname := 'Mesa ' || tb.label; end if;$a$,
                  $b$if cname = '' then cname := case when tb.kind = 'comanda' then 'Comanda ' else 'Mesa ' end || tb.label; end if;$b$);
  d := replace(d, $a$info := left('Mesa ' || tb.label || coalesce(' · garçom ' || wname, ''), 120);$a$,
                  $b$info := left(case when tb.kind = 'comanda' then 'Comanda ' else 'Mesa ' end || tb.label || coalesce(' · garçom ' || wname, ''), 120);$b$);
  execute d;
end $$;

-- ---------- robô: respostas personalizadas ----------
alter table public.whatsapp_bots add column if not exists messages jsonb not null default '{}'::jsonb check (jsonb_typeof(messages) = 'object' and pg_column_size(messages) < 20000);

-- ============================================================
-- Colaboradores: cada funcionário entra no painel com o próprio e-mail e senha
--   gerente   → painel inteiro, menos assinatura, dados da loja e equipe
--   atendente → pedidos, novo pedido (balcão), cozinha e entregas
--   cozinha   → só a tela da cozinha
-- As contas são criadas pela função "equipe" (precisa da chave de serviço).
-- ============================================================
create table if not exists public.restaurant_staff (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  email text not null check (char_length(email) <= 200),
  role text not null default 'atendente' check (role in ('gerente', 'atendente', 'cozinha')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists restaurant_staff_rest on public.restaurant_staff (restaurant_id);
alter table public.restaurant_staff enable row level security;
do $$ begin
  drop policy if exists "equipe le" on public.restaurant_staff;
  create policy "equipe le" on public.restaurant_staff for select to authenticated
    using (user_id = auth.uid() or exists (select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()) or public.is_admin());
end $$;
revoke insert, update, delete on public.restaurant_staff from anon, authenticated;

-- dono ou gerente: acesso de dono
create or replace function public.owns_restaurant(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = auth.uid())
      or exists (select 1 from public.restaurant_staff s where s.restaurant_id = rid and s.user_id = auth.uid() and s.active and s.role = 'gerente');
$$;
create or replace function public.owns_feature(rid uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.restaurants r where r.id = rid and public.plan_has(r.plan, p_feature)
       and (r.owner_id = auth.uid() or exists (select 1 from public.restaurant_staff s where s.restaurant_id = r.id and s.user_id = auth.uid() and s.active and s.role = 'gerente')));
$$;
-- qualquer pessoa da equipe (pedidos, cozinha, entregas)
create or replace function public.works_at(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.owns_restaurant(rid)
      or exists (select 1 from public.restaurant_staff s where s.restaurant_id = rid and s.user_id = auth.uid() and s.active);
$$;
grant execute on function public.works_at(uuid) to authenticated;

alter policy "dono le pedidos" on public.orders using (public.works_at(restaurant_id) or public.is_admin());
alter policy "dono atualiza pedidos" on public.orders using (public.works_at(restaurant_id) or public.is_admin()) with check (public.works_at(restaurant_id) or public.is_admin());
alter policy "dono le couriers" on public.couriers using (public.works_at(restaurant_id) or public.is_admin());
alter policy "dono le posicoes" on public.courier_positions using (public.works_at(restaurant_id) or public.is_admin());

create or replace function public.owner_place_order(p_rid uuid, p_customer jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s text; res jsonb;
begin
  if not (public.works_at(p_rid) or public.is_admin()) then raise exception 'Sem permissão'; end if;
  select slug into s from public.restaurants where id = p_rid;
  perform set_config('bora.pdv', '1', true);
  res := public.place_order(s, (p_customer - 'table' - 'scheduled_for' - 'coupon' - 'use_reward' - 'use_cashback'), p_items);
  perform set_config('bora.pdv', '', true);
  return res;
end;
$$;

-- a loja do usuário logado (dono ou equipe)
create or replace function public.my_store()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('id', r.id, 'role', 'dono') from public.restaurants r where r.owner_id = auth.uid() limit 1),
    (select jsonb_build_object('id', s.restaurant_id, 'role', s.role, 'name', s.name) from public.restaurant_staff s where s.user_id = auth.uid() and s.active limit 1));
$$;
grant execute on function public.my_store() to authenticated;
