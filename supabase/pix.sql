-- BoraLanchar! — Pix com QR Code e copia e cola (rode depois de loja-v2.sql)
alter table public.restaurants
  add column if not exists pix_key_type text,
  add column if not exists pix_name     text check (char_length(pix_name) <= 25),
  add column if not exists pix_city     text check (char_length(pix_city) <= 15),
  add column if not exists pix_bank     text check (char_length(pix_bank) <= 40);
do $$ begin
  alter table public.restaurants add constraint restaurants_pix_type_chk check (pix_key_type is null or pix_key_type in ('cpf','cnpj','celular','email','aleatoria'));
exception when duplicate_object then null; end $$;
alter table public.orders add column if not exists paid boolean not null default false;

create or replace function public.order_status(p_public_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('number', o.number, 'status', o.status, 'total', o.total, 'created_at', o.created_at,
                            'paid', o.paid, 'restaurant', r.name, 'whatsapp', r.whatsapp)
  from public.orders o join public.restaurants r on r.id = o.restaurant_id
  where o.public_id = p_public_id;
$$;
