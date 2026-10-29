-- BoraLanchar! — Corrida da Entrega: ranking do dia por loja + cupom de prêmio
alter table public.restaurants add column if not exists game_enabled boolean not null default true;
alter table public.restaurants add column if not exists game_reward_enabled boolean not null default false;
alter table public.restaurants add column if not exists game_reward_score integer not null default 2000 check (game_reward_score between 100 and 1000000);
alter table public.restaurants add column if not exists game_reward_kind text not null default 'percent' check (game_reward_kind in ('percent', 'fixed', 'frete'));
alter table public.restaurants add column if not exists game_reward_value numeric(10,2) not null default 10 check (game_reward_value >= 0 and game_reward_value <= 1000);
alter table public.restaurants add column if not exists game_reward_days integer not null default 7 check (game_reward_days between 1 and 60);

-- cupons criados pelo jogo ficam marcados (não aparecem na lista de cupons da loja)
alter table public.coupons add column if not exists source text;

create table if not exists public.game_scores (
  id bigserial primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id bigint not null unique references public.orders(id) on delete cascade,
  name text not null default 'Cliente',
  phone text,
  score integer not null default 0,
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  reward_coupon_id bigint references public.coupons(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists game_scores_rank on public.game_scores (restaurant_id, day, score desc);
alter table public.game_scores enable row level security;
do $$ begin
  create policy "dono le jogo" on public.game_scores for select to authenticated using (public.works_at(restaurant_id) or public.is_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on public.game_scores from anon, authenticated;

-- nome curto para o ranking: "Ana S."
create or replace function public._game_name(p text) returns text language sql immutable as $f$
  select case
    when coalesce(trim(p), '') = '' or p ~* '^(mesa|comanda)\M' then 'Cliente'
    else initcap(split_part(trim(p), ' ', 1)) || coalesce(' ' || upper(left(nullif(split_part(trim(p), ' ', 2), ''), 1)) || '.', '')
  end
$f$;

create or replace function public._game_top(p_rid uuid) returns jsonb language sql stable security definer set search_path = public as $f$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'score', score) order by score desc, updated_at), '[]'::jsonb)
  from (select name, score, updated_at from public.game_scores
        where restaurant_id = p_rid and day = (now() at time zone 'America/Sao_Paulo')::date and score > 0
        order by score desc, updated_at limit 10) t
$f$;

create or replace function public._game_rule(r public.restaurants) returns jsonb language sql stable as $f$
  select case when r.game_reward_enabled and public.plan_has(r.plan, 'cupons') then jsonb_build_object(
    'score', r.game_reward_score,
    'label', case r.game_reward_kind when 'percent' then trim(to_char(r.game_reward_value, 'FM990D##')) || '% de desconto'
                                     when 'fixed' then 'R$ ' || to_char(r.game_reward_value, 'FM999990D00') || ' de desconto'
                                     else 'entrega grátis' end,
    'days', r.game_reward_days) else null end
$f$;

-- ranking de hoje (público, pela página do pedido)
create or replace function public.game_ranking(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare r public.restaurants;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found or not r.game_enabled then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'top', public._game_top(r.id), 'rule', public._game_rule(r));
end $f$;

-- fim de partida: guarda a melhor pontuação do pedido e, se bater a meta, gera o cupom
create or replace function public.game_submit(p_public_id uuid, p_score integer) returns jsonb language plpgsql volatile security definer set search_path = public as $f$
declare o public.orders; r public.restaurants; g public.game_scores; sc integer; secs numeric; ph text; c public.coupons; v_code text; rew jsonb := null; rk integer;
begin
  select * into o from public.orders where public_id = p_public_id;
  if not found or o.status in ('cancelado', 'pagamento') then raise exception 'Pedido não encontrado'; end if;
  if o.created_at < now() - interval '12 hours' then raise exception 'O jogo vale até 12 horas depois do pedido'; end if;
  select * into r from public.restaurants where id = o.restaurant_id;
  if not r.game_enabled then raise exception 'O jogo está desligado nesta loja'; end if;
  -- trava contra pontuação impossível: no máximo ~120 pontos por segundo desde o pedido
  secs := extract(epoch from now() - o.created_at);
  sc := greatest(0, least(coalesce(p_score, 0), 200000, (secs * 120)::integer + 1500));
  ph := public.bora_phone(o.customer_phone);

  insert into public.game_scores (restaurant_id, order_id, name, phone, score)
  values (r.id, o.id, public._game_name(o.customer_name), ph, sc)
  on conflict (order_id) do update set score = greatest(public.game_scores.score, excluded.score), updated_at = now()
  returning * into g;

  -- prêmio: uma vez por pedido e uma vez por telefone por dia
  if g.reward_coupon_id is null and r.game_reward_enabled and public.plan_has(r.plan, 'cupons') and g.score >= r.game_reward_score
     and (r.game_reward_kind = 'frete' or r.game_reward_value > 0) then
    if ph is null or not exists (select 1 from public.game_scores x where x.restaurant_id = r.id and x.phone = ph and x.day = g.day and x.reward_coupon_id is not null) then
      loop
        v_code := 'JOGO' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        exit when not exists (select 1 from public.coupons x where x.restaurant_id = r.id and x.code = v_code);
      end loop;
      insert into public.coupons (restaurant_id, code, kind, value, min_order, max_uses, uses, once_per_customer, expires_at, active, source)
      values (r.id, v_code, r.game_reward_kind, case r.game_reward_kind when 'frete' then 0 when 'percent' then least(r.game_reward_value, 100) else r.game_reward_value end, 0, 1, 0, true,
              now() + make_interval(days => r.game_reward_days), true, 'jogo')
      returning * into c;
      update public.game_scores set reward_coupon_id = c.id where id = g.id returning * into g;
    end if;
  end if;
  if g.reward_coupon_id is not null then
    select * into c from public.coupons where id = g.reward_coupon_id;
    if found then rew := jsonb_build_object('code', c.code, 'expires_at', c.expires_at, 'used', c.uses >= coalesce(c.max_uses, 1)); end if;
  end if;

  select count(*) + 1 into rk from public.game_scores where restaurant_id = r.id and day = g.day and score > g.score;
  return jsonb_build_object('best', g.score, 'rank', rk, 'top', public._game_top(r.id), 'rule', public._game_rule(r), 'reward', rew);
end $f$;

revoke all on function public.game_submit(uuid, integer) from public;
grant execute on function public.game_submit(uuid, integer) to anon, authenticated;
grant execute on function public.game_ranking(text) to anon, authenticated;
revoke all on function public._game_top(uuid) from public, anon, authenticated;
