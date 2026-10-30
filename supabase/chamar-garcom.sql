-- ============================================================
-- BoraLanchar! — Chamar garçom e pedir a conta pelo QR Code da mesa
--   O cliente lê o QR Code (ou encosta o celular na placa NFC) e vê
--   "Como podemos ajudar?": Chamar garçom, Ver cardápio, Pedir a conta,
--   Instagram e Avaliar no Google. O chamado toca no painel e no app do garçom.
-- Plano: Completo (recurso 'mesas'). Pode rodar de novo sem problema.
-- ============================================================

alter table public.restaurants add column if not exists google_review_url text
  check (google_review_url is null or (char_length(google_review_url) <= 300 and google_review_url ~* '^https://'));
alter table public.restaurants add column if not exists calls_enabled boolean not null default true;

create table if not exists public.table_calls (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id bigint not null references public.dining_tables (id) on delete cascade,
  kind text not null check (kind in ('garcom', 'conta')),
  pay text check (pay is null or pay in ('pix', 'cartao', 'dinheiro')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by text check (char_length(done_by) <= 80)
);
create index if not exists table_calls_open on public.table_calls (restaurant_id, created_at desc) where done_at is null;
create index if not exists table_calls_table on public.table_calls (table_id, created_at desc);
alter table public.table_calls enable row level security;
do $$ begin
  drop policy if exists "equipe le chamados" on public.table_calls;
  create policy "equipe le chamados" on public.table_calls for select to authenticated
    using (public.works_at(restaurant_id) or public.is_admin());
  drop policy if exists "equipe atende chamados" on public.table_calls;
  create policy "equipe atende chamados" on public.table_calls for update to authenticated
    using (public.works_at(restaurant_id) or public.is_admin()) with check (public.works_at(restaurant_id) or public.is_admin());
end $$;
do $$ begin
  begin alter publication supabase_realtime add table public.table_calls; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- mesa válida a partir do link do QR Code
create or replace function public._call_table(p_slug text, p_token text)
returns public.dining_tables language plpgsql stable security definer set search_path = public as $$
declare t public.dining_tables;
begin
  if coalesce(p_token, '') !~* '^[0-9a-f-]{36}$' then return null; end if;
  select d.* into t from public.dining_tables d join public.restaurants r on r.id = d.restaurant_id
   where d.token = p_token::uuid and r.slug = lower(p_slug) and d.active and r.calls_enabled and public.plan_has(r.plan, 'mesas');
  return t;
end;
$$;
revoke all on function public._call_table(text, text) from public, anon, authenticated;

-- cliente chama o garçom ou pede a conta (um chamado aberto por tipo; no máximo 1 a cada 20 s por mesa)
create or replace function public.table_call(p_slug text, p_token text, p_kind text, p_pay text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.dining_tables; c public.table_calls;
begin
  if p_kind not in ('garcom', 'conta') then raise exception 'Chamado inválido.'; end if;
  t := public._call_table(p_slug, p_token);
  if t.id is null then raise exception 'Esta mesa não aceita chamados agora. Chame alguém da equipe.'; end if;
  select * into c from public.table_calls where table_id = t.id and kind = p_kind and done_at is null and created_at > now() - interval '2 hours'
   order by id desc limit 1;
  if found then
    if p_kind = 'conta' and p_pay in ('pix', 'cartao', 'dinheiro') then update public.table_calls set pay = p_pay where id = c.id returning * into c; end if;
    return jsonb_build_object('id', c.id, 'kind', c.kind, 'created_at', c.created_at, 'again', true);
  end if;
  if exists (select 1 from public.table_calls where table_id = t.id and created_at > now() - interval '20 seconds') then
    raise exception 'Seu chamado já foi enviado. Aguarde um instante.';
  end if;
  insert into public.table_calls (restaurant_id, table_id, kind, pay)
  values (t.restaurant_id, t.id, p_kind, case when p_kind = 'conta' and p_pay in ('pix', 'cartao', 'dinheiro') then p_pay end)
  returning * into c;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'created_at', c.created_at, 'again', false);
end;
$$;
grant execute on function public.table_call(text, text, text, text) to anon, authenticated;

-- cliente acompanha os chamados da mesa (para mostrar "a caminho" / "atendido")
create or replace function public.table_call_status(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.dining_tables;
begin
  t := public._call_table(p_slug, p_token);
  if t.id is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'pay', c.pay, 'created_at', c.created_at, 'done_at', c.done_at) order by c.id desc)
    from public.table_calls c where c.table_id = t.id and c.created_at > now() - interval '2 hours'), '[]'::jsonb);
end;
$$;
grant execute on function public.table_call_status(text, text) to anon, authenticated;

-- dados da tela "Como podemos ajudar?"
create or replace function public.table_hub(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.dining_tables; r public.restaurants;
begin
  t := public._call_table(p_slug, p_token);
  if t.id is null then return null; end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  return jsonb_build_object('instagram', r.instagram, 'google_review_url', r.google_review_url, 'calls', true);
end;
$$;
grant execute on function public.table_hub(text, text) to anon, authenticated;

-- app do garçom: chamados abertos e "atendido"
create or replace function public.waiter_calls(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'pay', c.pay, 'created_at', c.created_at,
      'table_id', t.id, 'label', t.label, 'tkind', t.kind) order by c.id)
    from public.table_calls c join public.dining_tables t on t.id = c.table_id
    where c.restaurant_id = me.restaurant_id and c.done_at is null and c.created_at > now() - interval '2 hours'), '[]'::jsonb);
end;
$$;
grant execute on function public.waiter_calls(uuid) to anon, authenticated;

create or replace function public.waiter_call_done(p_token uuid, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public._waiter(p_token);
  if me.waiter_id is null then raise exception 'Sessão expirada. Entre de novo com o seu PIN.'; end if;
  update public.table_calls set done_at = now(), done_by = left(me.waiter_name, 80)
   where id = p_id and restaurant_id = me.restaurant_id and done_at is null;
end;
$$;
grant execute on function public.waiter_call_done(uuid, bigint) to anon, authenticated;

-- limpeza: chamados com mais de 30 dias
delete from public.table_calls where created_at < now() - interval '30 days';
