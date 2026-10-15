-- BoraLanchar! — Pix com confirmação automática (rode depois de pix-fluxo.sql)
-- + função do servidor supabase/functions/pix (Mercado Pago)
alter table public.restaurants add column if not exists pix_auto boolean not null default false;
alter table public.orders add column if not exists mp_payment_id text check (char_length(mp_payment_id) <= 40);

-- Segredos da loja (token do Mercado Pago): ninguém lê pelo site, só a função do servidor
create table if not exists public.restaurant_secrets (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  mp_access_token text,
  mp_account text,
  updated_at timestamptz not null default now()
);
alter table public.restaurant_secrets enable row level security;
revoke all on public.restaurant_secrets from anon, authenticated;

-- Libera o pedido para a loja (número + status novo). Uso interno.
create or replace function public.release_order(p_order_id bigint, p_paid boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; num int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status <> 'pagamento' then
    if p_paid and not o.paid then update public.orders set paid = true where id = o.id; end if;
    return jsonb_build_object('number', o.number, 'status', o.status);
  end if;
  perform pg_advisory_xact_lock(hashtext(o.restaurant_id::text));
  select coalesce(max(number), 0) + 1 into num from public.orders where restaurant_id = o.restaurant_id;
  update public.orders set status = 'novo', number = num, paid = p_paid, pix_informed_at = now(), created_at = now()
   where id = o.id;
  return jsonb_build_object('number', num, 'status', 'novo');
end;
$$;
revoke execute on function public.release_order(bigint, boolean) from public, anon, authenticated;

-- Dono confirma que o Pix caiu na conta: o pedido entra na fila
create or replace function public.owner_confirm_pix(p_order_id bigint)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.orders where id = p_order_id;
  if rid is null or not (public.owns_restaurant(rid) or public.is_admin()) then raise exception 'Sem permissão'; end if;
  return public.release_order(p_order_id, true);
end;
$$;
revoke execute on function public.owner_confirm_pix(bigint) from public, anon;
grant execute on function public.owner_confirm_pix(bigint) to authenticated;

-- O cliente não confirma sozinho
revoke execute on function public.confirm_pix_paid(uuid) from public, anon, authenticated;

-- pix_auto só muda pelo servidor (ao conectar o Mercado Pago)
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
    if auth.uid() is not null then new.pix_auto := old.pix_auto; end if;
  end if;
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
  if new.opening_hours is not null then
    for k, iv in select key, value from jsonb_each(new.opening_hours) loop
      if k !~ '^[0-6]$' or jsonb_typeof(iv) <> 'array' then raise exception 'Horário inválido'; end if;
      perform (x ->> 0)::time, (x ->> 1)::time from jsonb_array_elements(iv) x;
    end loop;
  end if;
  return new;
end;
$$;
revoke execute on function public.restaurants_guard() from public, anon, authenticated;
