-- BoraLanchar! — cancelar assinatura / excluir loja (rode depois de assinaturas.sql)
-- A exclusão é feita pela função do servidor supabase/functions/admin-loja (só administrador).
alter table public.restaurants drop constraint if exists restaurants_status_check;
alter table public.restaurants add constraint restaurants_status_check check (status in ('teste', 'ativo', 'suspenso', 'cancelado'));
alter table public.restaurants add column if not exists canceled_at timestamptz;

create or replace function public.admin_cancel_restaurant(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  update public.restaurants set status = 'cancelado', canceled_at = now(), is_open = false where id = p_rid;
  update public.subscription_payments set status = 'cancelado' where restaurant_id = p_rid and status = 'pendente';
end;
$$;
revoke execute on function public.admin_cancel_restaurant(uuid) from public, anon;
grant execute on function public.admin_cancel_restaurant(uuid) to authenticated;
