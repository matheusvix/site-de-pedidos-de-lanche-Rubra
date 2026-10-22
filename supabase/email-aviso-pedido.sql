-- BoraLanchar! — e-mail de "pedido novo" para o dono da loja (Edge Function aviso-pedido + Resend)
create extension if not exists pg_net with schema extensions;

alter table public.restaurants add column if not exists email_new_order boolean not null default true;

create or replace function public.email_aviso_pedido()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if new.status <> 'novo' or new.table_id is not null then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  select wa_hook_secret into s from public.platform_secrets where id = 1;
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://bqjzdtsthhcuynokdzik.supabase.co/functions/v1/aviso-pedido',
    body := jsonb_build_object('order_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bora-hook', s),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new; -- o aviso nunca pode travar o pedido
end;
$$;
drop trigger if exists email_aviso_pedido on public.orders;
create trigger email_aviso_pedido after insert or update of status on public.orders
for each row execute function public.email_aviso_pedido();

revoke execute on function public.email_aviso_pedido() from public, anon, authenticated;
