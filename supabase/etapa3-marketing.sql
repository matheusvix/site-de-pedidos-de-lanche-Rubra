-- ============================================================
-- BoraLanchar! — Etapa 3: Marketing (planos Profissional e Completo)
--   • Cashback: % do pedido entregue vira saldo para o próximo pedido
--   • Recuperar clientes: registro de quem já foi chamado no WhatsApp
--   • Avaliação do pedido (estrelas + comentário) e nota da loja
-- Rode depois do etapa2-cardapio-relatorios.sql. Pode rodar de novo sem problema.
-- ============================================================

alter table public.restaurants add column if not exists cashback_enabled boolean not null default false;
alter table public.restaurants add column if not exists cashback_pct numeric(4,1) not null default 5 check (cashback_pct between 0.5 and 50);
alter table public.restaurants add column if not exists cashback_days int not null default 30 check (cashback_days between 1 and 365);
alter table public.orders add column if not exists cashback_used numeric(10,2) not null default 0;
alter table public.orders add column if not exists cashback_earned numeric(10,2) not null default 0;

create table if not exists public.cashback_wallets (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null,
  name text,
  balance numeric(10,2) not null default 0 check (balance >= 0),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, phone)
);
alter table public.cashback_wallets enable row level security;

create table if not exists public.recover_sends (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null check (char_length(phone) <= 13),
  sent_at timestamptz not null default now()
);
create index if not exists recover_sends_idx on public.recover_sends (restaurant_id, phone, sent_at desc);
alter table public.recover_sends enable row level security;

create table if not exists public.order_ratings (
  order_id bigint primary key references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists order_ratings_rest on public.order_ratings (restaurant_id, created_at desc);
alter table public.order_ratings enable row level security;

do $$ begin
  drop policy if exists "dono le carteiras" on public.cashback_wallets;
  create policy "dono le carteiras" on public.cashback_wallets for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin());
  drop policy if exists "dono le recuperar" on public.recover_sends;
  create policy "dono le recuperar" on public.recover_sends for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin());
  drop policy if exists "dono registra recuperar" on public.recover_sends;
  create policy "dono registra recuperar" on public.recover_sends for insert to authenticated with check (public.owns_feature(restaurant_id, 'cupons'));
  drop policy if exists "dono le avaliacoes" on public.order_ratings;
  create policy "dono le avaliacoes" on public.order_ratings for select to authenticated using (public.owns_restaurant(restaurant_id) or public.is_admin());
end $$;
revoke insert, update, delete on public.cashback_wallets, public.order_ratings from anon, authenticated;
revoke update, delete on public.recover_sends from anon, authenticated;
revoke all on public.recover_sends from anon;

-- ---------- cashback: ganha quando entrega, devolve quando cancela ----------
create or replace function public.orders_cashback()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.restaurants; ph text := public.bora_phone(new.customer_phone); earn numeric(10,2);
begin
  if new.status is not distinct from old.status or ph is null then return null; end if;
  select * into r from public.restaurants where id = new.restaurant_id;
  if new.status = 'entregue' and new.cashback_earned = 0 and new.mode <> 'mesa' and r.cashback_enabled and public.plan_has(r.plan, 'cupons') then
    earn := round(greatest(0, new.total - new.fee) * r.cashback_pct / 100, 2);
    if earn > 0 then
      insert into public.cashback_wallets as w (restaurant_id, phone, name, balance, expires_at)
      values (r.id, ph, new.customer_name, earn, now() + make_interval(days => r.cashback_days))
      on conflict (restaurant_id, phone) do update set
        balance = (case when w.expires_at is null or w.expires_at > now() then w.balance else 0 end) + earn,
        expires_at = now() + make_interval(days => r.cashback_days), name = excluded.name, updated_at = now();
      update public.orders set cashback_earned = earn where id = new.id;
    end if;
  elsif new.status = 'cancelado' then
    if new.cashback_used > 0 then
      insert into public.cashback_wallets as w (restaurant_id, phone, name, balance, expires_at)
      values (r.id, ph, new.customer_name, new.cashback_used, now() + make_interval(days => r.cashback_days))
      on conflict (restaurant_id, phone) do update set balance = w.balance + new.cashback_used,
        expires_at = greatest(coalesce(w.expires_at, now()), now() + interval '7 days'), updated_at = now();
    end if;
    if new.cashback_earned > 0 then
      update public.cashback_wallets set balance = greatest(0, balance - new.cashback_earned), updated_at = now()
       where restaurant_id = r.id and phone = ph;
    end if;
    if new.cashback_used > 0 or new.cashback_earned > 0 then
      update public.orders set cashback_used = 0, cashback_earned = 0 where id = new.id;
    end if;
  end if;
  return null;
end;
$$;
create or replace trigger orders_cashback after update of status on public.orders
for each row execute function public.orders_cashback();

-- saldo do cliente (cardápio)
create or replace function public.cashback_status(p_slug text, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.restaurants; w public.cashback_wallets; ph text := public.bora_phone(p_phone);
begin
  select * into r from public.restaurants where slug = lower(p_slug);
  if not found or not r.cashback_enabled or not public.plan_has(r.plan, 'cupons') then return jsonb_build_object('enabled', false); end if;
  if ph is not null then select * into w from public.cashback_wallets where restaurant_id = r.id and phone = ph; end if;
  return jsonb_build_object('enabled', true, 'pct', r.cashback_pct, 'days', r.cashback_days,
    'balance', case when w.expires_at > now() then w.balance else 0 end, 'expires_at', case when w.expires_at > now() then w.expires_at end);
end;
$$;
grant execute on function public.cashback_status(text, text) to anon, authenticated;

-- ---------- avaliação do pedido ----------
create or replace function public.rate_order(p_public_id uuid, p_stars int, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where public_id = p_public_id;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status <> 'entregue' then raise exception 'Você pode avaliar depois que o pedido for entregue'; end if;
  if o.created_at < now() - interval '10 days' then raise exception 'O prazo para avaliar este pedido acabou'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Escolha de 1 a 5 estrelas'; end if;
  insert into public.order_ratings (order_id, restaurant_id, stars, comment)
  values (o.id, o.restaurant_id, p_stars, nullif(left(trim(coalesce(p_comment, '')), 500), ''))
  on conflict (order_id) do nothing;
  if not found then raise exception 'Este pedido já foi avaliado. Obrigado!'; end if;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.rate_order(uuid, int, text) to anon, authenticated;

create or replace function public.order_rated(p_public_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('stars', r.stars) from public.order_ratings r join public.orders o on o.id = r.order_id where o.public_id = p_public_id;
$$;
grant execute on function public.order_rated(uuid) to anon, authenticated;

-- nota da loja no cardápio (só aparece com 5 avaliações ou mais)
create or replace function public.store_rating(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('avg', round(avg(x.stars)::numeric, 1), 'count', count(*))
    from public.order_ratings x join public.restaurants r on r.id = x.restaurant_id
   where r.slug = lower(p_slug) and x.created_at > now() - interval '180 days'
  having count(*) >= 5;
$$;
grant execute on function public.store_rating(text) to anon, authenticated;

-- ---------- pedido: usar o saldo de cashback (ajusta a função place_order já instalada) ----------
do $$
declare d text := pg_get_functiondef('public.place_order(text,jsonb,jsonb)'::regprocedure);
  a1 text := E'  src text;\nbegin';
  a2 text := E'  disc := greatest(0, least(disc, sub + fee));';
  a3 text := E'source, scheduled_for, paid)';
  a4 text := $a$src, sched, pdv and coalesce(p_customer ->> 'paid', '') = 'true')$a$;
begin
  if position('cashback_used' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 or position(a4 in d) = 0 then raise exception 'Rode antes o etapa2-cardapio-relatorios.sql'; end if;
  d := replace(d, a1, E'  src text;\n  cb numeric(10,2) := 0; cbal numeric(10,2);\nbegin');
  d := replace(d, a2, $b$  -- cashback: usa o saldo inteiro (não junta com cupom)
  if not pdv and m <> 'mesa' and coalesce(p_customer ->> 'use_cashback', '') = 'true' and ccode is null
     and r.cashback_enabled and public.plan_has(r.plan, 'cupons') then
    ph := public.bora_phone(p_customer ->> 'phone');
    select case when expires_at > now() then balance else 0 end into cbal
      from public.cashback_wallets where restaurant_id = r.id and phone = ph for update;
    cb := least(coalesce(cbal, 0), greatest(0, sub + fee - disc));
    if cb > 0 then
      update public.cashback_wallets set balance = balance - cb, updated_at = now() where restaurant_id = r.id and phone = ph;
      disc := disc + cb;
    end if;
  end if;
$b$ || a2);
  d := replace(d, a3, 'source, scheduled_for, paid, cashback_used)');
  d := replace(d, a4, $c$src, sched, pdv and coalesce(p_customer ->> 'paid', '') = 'true', cb)$c$);
  execute d;
end $$;
