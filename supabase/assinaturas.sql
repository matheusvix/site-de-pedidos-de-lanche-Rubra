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
