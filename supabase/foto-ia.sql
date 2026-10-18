-- ============================================================
-- BoraLanchar! — Foto do produto gerada por IA
-- Registro de uso (limite mensal por loja). Só a função do servidor mexe aqui.
-- + função do servidor supabase/functions/foto-produto (precisa do segredo GEMINI_API_KEY)
-- ============================================================
create table if not exists public.ai_image_log (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  product_name text check (char_length(product_name) <= 120),
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ai_image_log_rest_idx on public.ai_image_log (restaurant_id, created_at desc);
alter table public.ai_image_log enable row level security;
-- (sem políticas: o site não lê nem escreve; só o servidor)
