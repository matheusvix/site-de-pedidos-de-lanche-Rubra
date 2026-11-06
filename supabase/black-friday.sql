-- ============================================================
-- BoraLanchar! — Black Friday 2026 (vale até 30/11/2026, 23h59 de Brasília)
--   • Quem cria a loja na campanha ganha 15 dias de teste grátis (em vez de 7).
--   • Quem é cliente novo (loja criada na campanha, ou ainda no teste e sem nenhum
--     pagamento) e assina até 30/11 paga 30% a menos nas 3 primeiras mensalidades,
--     mesmo que a 2ª e a 3ª caiam depois de novembro.
-- Rode depois de assinaturas.sql. Pode rodar de novo sem problema.
-- ============================================================

create or replace function public.bf_ends() returns timestamptz language sql immutable as $$ select '2026-12-01 03:00:00+00'::timestamptz $$;
create or replace function public.bf_active() returns boolean language sql stable as $$ select now() < public.bf_ends() $$;

alter table public.restaurants add column if not exists promo_bf_at timestamptz;

-- loja nova durante a campanha: 15 dias de teste e entra na oferta
create or replace function public.restaurants_bf_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.bf_active() then
    new.trial_ends_at := greatest(coalesce(new.trial_ends_at, now()), now() + interval '15 days');
    new.promo_bf_at := coalesce(new.promo_bf_at, now());
  end if;
  return new;
end; $$;
drop trigger if exists restaurants_bf_insert on public.restaurants;
create trigger restaurants_bf_insert before insert on public.restaurants for each row execute function public.restaurants_bf_insert();

-- o dono não mexe no campo da oferta (só o servidor e o admin)
create or replace function public.restaurants_bf_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and coalesce(current_setting('bora.bf', true), '') <> '1' then new.promo_bf_at := old.promo_bf_at; end if;
  return new;
end; $$;
drop trigger if exists restaurants_bf_guard on public.restaurants;
create trigger restaurants_bf_guard before update on public.restaurants for each row execute function public.restaurants_bf_guard();
revoke execute on function public.restaurants_bf_insert() from public, anon, authenticated;
revoke execute on function public.restaurants_bf_guard() from public, anon, authenticated;

-- quantas mensalidades com desconto ainda restam (0 = sem desconto)
create or replace function public.bf_left(rid uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when r.promo_bf_at is null then 0 else greatest(0, 3 - (
    select count(*) from public.subscription_payments p where p.restaurant_id = r.id and p.status = 'pago' and p.created_at >= r.promo_bf_at))::int end
  from public.restaurants r where r.id = rid; $$;
revoke execute on function public.bf_left(uuid) from public, anon, authenticated;

-- cliente que ainda não pagou nada entra na oferta ao assinar durante a campanha
create or replace function public.bf_enroll(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.bf_active() and not exists (select 1 from public.subscription_payments where restaurant_id = rid and status = 'pago') then
    perform set_config('bora.bf', '1', true);
    update public.restaurants set promo_bf_at = coalesce(promo_bf_at, now()) where id = rid;
    perform set_config('bora.bf', '', true);
  end if;
end; $$;
revoke execute on function public.bf_enroll(uuid) from public, anon, authenticated;

create or replace function public.start_subscription(p_plan text, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid; sp public.subscription_payments; v numeric;
begin
  select id into rid from public.restaurants where owner_id = auth.uid();
  if rid is null then raise exception 'Crie sua conta primeiro'; end if;
  if public.plan_price(p_plan) is null then raise exception 'Plano inválido'; end if;
  if p_method not in ('pix', 'cartao', 'boleto') then raise exception 'Forma de pagamento inválida'; end if;
  perform public.bf_enroll(rid);
  v := public.plan_price(p_plan);
  if public.bf_left(rid) > 0 then v := round(v * 0.7, 2); end if;
  update public.subscription_payments set status = 'cancelado' where restaurant_id = rid and status = 'pendente';
  insert into public.subscription_payments (restaurant_id, plan, amount, method)
  values (rid, p_plan, v, p_method) returning * into sp;
  return to_jsonb(sp);
end; $$;
revoke execute on function public.start_subscription(text, text) from public, anon;
grant execute on function public.start_subscription(text, text) to authenticated;

-- o que a tela de assinatura mostra para quem está logado
create or replace function public.my_offer()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.restaurants; paid boolean; left_ int;
begin
  select * into r from public.restaurants where owner_id = auth.uid();
  if r.id is null then return jsonb_build_object('campaign', public.bf_active(), 'months', case when public.bf_active() then 3 else 0 end); end if;
  paid := exists (select 1 from public.subscription_payments where restaurant_id = r.id and status = 'pago');
  left_ := public.bf_left(r.id);
  if left_ = 0 and r.promo_bf_at is null and public.bf_active() and not paid then left_ := 3; end if;
  return jsonb_build_object('campaign', public.bf_active(), 'months', left_);
end; $$;
revoke execute on function public.my_offer() from public, anon;
grant execute on function public.my_offer() to authenticated;

-- quem está no teste agora também ganha os 15 dias e entra na oferta
update public.restaurants
   set trial_ends_at = greatest(trial_ends_at, created_at + interval '15 days'),
       promo_bf_at = coalesce(promo_bf_at, now())
 where public.bf_active() and status = 'teste' and trial_ends_at > now();
