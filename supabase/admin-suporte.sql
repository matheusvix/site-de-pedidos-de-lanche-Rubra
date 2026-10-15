-- BoraLanchar! — área do dono do sistema: clientes e modo suporte (rode depois de pix-auto.sql)
create table if not exists public.support_log (
  id            bigint generated always as identity primary key,
  admin_email   text,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  created_at    timestamptz not null default now()
);
alter table public.support_log enable row level security;
drop policy if exists "admin le suporte" on public.support_log;
create policy "admin le suporte" on public.support_log for select to authenticated using (public.is_admin());
grant select on public.support_log to authenticated;

create or replace function public.admin_support_log(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  insert into public.support_log (admin_email, restaurant_id) values (auth.jwt() ->> 'email', p_rid);
end;
$$;
revoke execute on function public.admin_support_log(uuid) from public, anon;
grant execute on function public.admin_support_log(uuid) to authenticated;

create or replace function public.admin_clients()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  return query
  select to_jsonb(r) - 'old_slugs' || jsonb_build_object(
           'owner_email', u.email,
           'owner_name', u.raw_user_meta_data ->> 'nome',
           'last_sign_in', u.last_sign_in_at,
           'orders_30d', coalesce(o.n, 0),
           'revenue_30d', coalesce(o.total, 0),
           'last_order', o.last_at,
           'products', coalesce(p.n, 0))
  from public.restaurants r
  left join auth.users u on u.id = r.owner_id
  left join lateral (
    select count(*) n, sum(total) total, max(created_at) last_at from public.orders
     where restaurant_id = r.id and status not in ('pagamento', 'cancelado') and created_at > now() - interval '30 days'
  ) o on true
  left join lateral (select count(*) n from public.products where restaurant_id = r.id) p on true
  order by r.created_at desc;
end;
$$;
revoke execute on function public.admin_clients() from public, anon;
grant execute on function public.admin_clients() to authenticated;

-- fotos no modo suporte
drop policy if exists "admin envia fotos" on storage.objects;
create policy "admin envia fotos" on storage.objects for insert to authenticated with check (bucket_id = 'produtos' and public.is_admin());
drop policy if exists "admin troca fotos" on storage.objects;
create policy "admin troca fotos" on storage.objects for update to authenticated using (bucket_id = 'produtos' and public.is_admin());
drop policy if exists "admin apaga fotos" on storage.objects;
create policy "admin apaga fotos" on storage.objects for delete to authenticated using (bucket_id = 'produtos' and public.is_admin());
