-- ============================================================
-- BoraLanchar! — Robô de atendimento no WhatsApp (API oficial da Meta)
-- Rode depois do instalar-tudo.sql. Pode rodar de novo sem problema.
-- + função do servidor supabase/functions/whatsapp
-- ============================================================
create extension if not exists pg_net with schema extensions;

-- Configuração do robô de cada loja (o dono lê e edita; sem segredos aqui)
create table if not exists public.whatsapp_bots (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  enabled boolean not null default false,
  phone_number_id text unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id text check (waba_id ~ '^[0-9]{5,30}$'),
  display_phone text check (char_length(display_phone) <= 30),
  verified_name text check (char_length(verified_name) <= 120),
  greeting text check (char_length(greeting) <= 600),
  away_text text check (char_length(away_text) <= 600),
  faq jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 30 and pg_column_size(faq) < 30000),
  notify_status boolean not null default true,
  template_name text check (template_name ~ '^[a-z0-9_]{1,60}$'),
  template_lang text not null default 'pt_BR' check (char_length(template_lang) <= 10),
  human_minutes int not null default 120 check (human_minutes between 5 and 1440),
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_bots enable row level security;
drop policy if exists "dono le robo" on public.whatsapp_bots;
create policy "dono le robo" on public.whatsapp_bots for select to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin());
drop policy if exists "dono edita robo" on public.whatsapp_bots;
create policy "dono edita robo" on public.whatsapp_bots for update to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin())
  with check (public.owns_restaurant(restaurant_id) or public.is_admin());

-- O número conectado só muda pela função do servidor (que confere o token na Meta)
create or replace function public.whatsapp_bots_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.phone_number_id := old.phone_number_id;
    new.waba_id := old.waba_id;
    new.display_phone := old.display_phone;
    new.verified_name := old.verified_name;
    new.restaurant_id := old.restaurant_id;
    if new.phone_number_id is null then new.enabled := false; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists whatsapp_bots_guard on public.whatsapp_bots;
create trigger whatsapp_bots_guard before update on public.whatsapp_bots
for each row execute function public.whatsapp_bots_guard();

-- Token da Meta de cada loja: ninguém lê pelo site, só a função do servidor
alter table public.restaurant_secrets add column if not exists wa_token text;
alter table public.restaurant_secrets add column if not exists wa_app_secret text;

-- Segredos da plataforma para o webhook da Meta e o aviso de status
alter table public.platform_secrets add column if not exists wa_verify_token text;
alter table public.platform_secrets add column if not exists wa_app_secret text;
alter table public.platform_secrets add column if not exists wa_hook_secret text;
insert into public.platform_secrets (id) values (1) on conflict (id) do nothing;
update public.platform_secrets
   set wa_verify_token = coalesce(wa_verify_token, 'bora-' || replace(gen_random_uuid()::text, '-', '')),
       wa_hook_secret  = coalesce(wa_hook_secret, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
 where id = 1;

-- Conversas (um contato por loja) e mensagens
create table if not exists public.wa_conversations (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{8,20}$'),
  name text check (char_length(name) <= 120),
  last_msg_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  human_until timestamptz,
  unread int not null default 0,
  created_at timestamptz not null default now(),
  unique (restaurant_id, wa_id)
);
create index if not exists wa_conv_rest_idx on public.wa_conversations (restaurant_id, last_msg_at desc);
alter table public.wa_conversations enable row level security;
drop policy if exists "dono le conversas" on public.wa_conversations;
create policy "dono le conversas" on public.wa_conversations for select to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin());
drop policy if exists "dono atualiza conversas" on public.wa_conversations;
create policy "dono atualiza conversas" on public.wa_conversations for update to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin())
  with check (public.owns_restaurant(restaurant_id) or public.is_admin());

create or replace function public.wa_conversations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    -- pelo painel o dono só devolve para o robô / assume o atendimento e zera os não lidos
    new.restaurant_id := old.restaurant_id; new.wa_id := old.wa_id; new.name := old.name;
    new.last_msg_at := old.last_msg_at; new.last_inbound_at := old.last_inbound_at; new.created_at := old.created_at;
    if new.unread <> 0 then new.unread := old.unread; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists wa_conversations_guard on public.wa_conversations;
create trigger wa_conversations_guard before update on public.wa_conversations
for each row execute function public.wa_conversations_guard();

create table if not exists public.wa_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.wa_conversations (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text not null default 'robo' check (sender in ('cliente', 'robo', 'loja', 'aviso')),
  body text check (char_length(body) <= 4096),
  wa_msg_id text unique check (char_length(wa_msg_id) <= 200),
  status text check (char_length(status) <= 20),
  created_at timestamptz not null default now()
);
create index if not exists wa_msg_conv_idx on public.wa_messages (conversation_id, created_at desc);
alter table public.wa_messages enable row level security;
drop policy if exists "dono le mensagens" on public.wa_messages;
create policy "dono le mensagens" on public.wa_messages for select to authenticated
  using (public.owns_restaurant(restaurant_id) or public.is_admin());

-- Tempo real no painel
do $$ begin
  begin alter publication supabase_realtime add table public.wa_conversations; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- Linha de configuração para toda loja (as novas ganham na criação)
insert into public.whatsapp_bots (restaurant_id) select id from public.restaurants on conflict do nothing;
create or replace function public.whatsapp_bot_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_bots (restaurant_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists whatsapp_bot_row on public.restaurants;
create trigger whatsapp_bot_row after insert on public.restaurants
for each row execute function public.whatsapp_bot_row();

-- Aviso automático ao cliente quando o status do pedido muda
create or replace function public.wa_notify_status()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare b public.whatsapp_bots; s text;
begin
  if new.status = 'pagamento' then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select * into b from public.whatsapp_bots where restaurant_id = new.restaurant_id;
  if not found or not b.enabled or not b.notify_status or b.phone_number_id is null then return new; end if;
  select wa_hook_secret into s from public.platform_secrets where id = 1;
  if s is null then return new; end if;
  perform net.http_post(
    url := 'https://bqjzdtsthhcuynokdzik.supabase.co/functions/v1/whatsapp?action=notify',
    body := jsonb_build_object('order_id', new.id, 'status', new.status),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bora-hook', s),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new; -- o aviso nunca pode travar a mudança do pedido
end;
$$;
drop trigger if exists wa_notify_status on public.orders;
create trigger wa_notify_status after insert or update of status on public.orders
for each row execute function public.wa_notify_status();

revoke execute on function public.wa_notify_status() from public, anon, authenticated;
revoke execute on function public.whatsapp_bot_row() from public, anon, authenticated;

-- Mensagem recebida: soma 1 em "não lidas" de forma segura (várias mensagens no mesmo segundo)
create or replace function public.wa_touch_inbound(p_conv bigint, p_name text)
returns void language sql security definer set search_path = public as $$
  update public.wa_conversations
     set last_msg_at = now(), last_inbound_at = now(), unread = unread + 1, name = coalesce(nullif(p_name, ''), name)
   where id = p_conv;
$$;
revoke execute on function public.wa_touch_inbound(bigint, text) from public, anon, authenticated;
grant execute on function public.wa_touch_inbound(bigint, text) to service_role;

-- ============================================================
-- Admin: visão do robô do WhatsApp em todas as lojas
-- ============================================================
create or replace function public.admin_whatsapp_overview()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  return query
  select jsonb_build_object(
           'restaurant_id', r.id, 'name', r.name, 'slug', r.slug, 'plan', r.plan, 'status', r.status, 'logo_url', r.logo_url,
           'enabled', b.enabled, 'connected', b.phone_number_id is not null and s.wa_token is not null,
           'display_phone', b.display_phone, 'verified_name', b.verified_name,
           'is_test', coalesce(b.verified_name, '') ilike 'test number%' or coalesce(b.display_phone, '') like '+1 555%',
           'notify_status', b.notify_status, 'faq_count', jsonb_array_length(b.faq),
           'convs', coalesce(c.n, 0), 'waiting', coalesce(c.waiting, 0), 'unread', coalesce(c.unread, 0),
           'in_7d', coalesce(m.n_in, 0), 'out_7d', coalesce(m.n_out, 0), 'failed_7d', coalesce(m.n_fail, 0),
           'last_msg_at', c.last_at, 'updated_at', b.updated_at)
  from public.whatsapp_bots b
  join public.restaurants r on r.id = b.restaurant_id
  left join public.restaurant_secrets s on s.restaurant_id = b.restaurant_id
  left join lateral (
    select count(*) n, count(*) filter (where human_until > now()) waiting, sum(unread) unread, max(last_msg_at) last_at
      from public.wa_conversations where restaurant_id = b.restaurant_id
  ) c on true
  left join lateral (
    select count(*) filter (where direction = 'in') n_in, count(*) filter (where direction = 'out') n_out,
           count(*) filter (where status = 'failed') n_fail
      from public.wa_messages where restaurant_id = b.restaurant_id and created_at > now() - interval '7 days'
  ) m on true
  order by (b.phone_number_id is not null) desc, c.last_at desc nulls last, r.created_at desc;
end;
$$;
revoke execute on function public.admin_whatsapp_overview() from public, anon;
grant execute on function public.admin_whatsapp_overview() to authenticated;

-- Últimas falhas de envio (para o admin ver o motivo)
create or replace function public.admin_whatsapp_failures(p_limit int default 20)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  return query
  select jsonb_build_object('created_at', m.created_at, 'store', r.name, 'sender', m.sender, 'body', left(m.body, 300))
    from public.wa_messages m join public.restaurants r on r.id = m.restaurant_id
   where m.status = 'failed'
   order by m.created_at desc limit least(greatest(p_limit, 1), 100);
end;
$$;
revoke execute on function public.admin_whatsapp_failures(int) from public, anon;
grant execute on function public.admin_whatsapp_failures(int) to authenticated;

-- Dados do webhook para configurar o app na Meta (só admin)
create or replace function public.admin_whatsapp_platform()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Sem permissão'; end if;
  select jsonb_build_object('verify_token', wa_verify_token, 'app_secret_ok', wa_app_secret is not null, 'hook_ok', wa_hook_secret is not null)
    into v from public.platform_secrets where id = 1;
  return coalesce(v, '{}'::jsonb);
end;
$$;
revoke execute on function public.admin_whatsapp_platform() from public, anon;
grant execute on function public.admin_whatsapp_platform() to authenticated;
