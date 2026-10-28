-- BoraLanchar! — Robô do WhatsApp conectado por código (aparelho conectado)
-- O número da loja continua no celular; o robô entra como "dispositivo conectado"
-- através do servidor Evolution API do BoraLanchar (ver servidor-whatsapp/).

alter table public.whatsapp_bots add column if not exists provider text not null default 'meta';
do $$ begin
  alter table public.whatsapp_bots add constraint whatsapp_bots_provider_chk check (provider in ('meta', 'qr'));
exception when duplicate_object then null; end $$;
alter table public.whatsapp_bots add column if not exists qr_instance text;
alter table public.whatsapp_bots add column if not exists qr_state text;
create unique index if not exists whatsapp_bots_qr_instance on public.whatsapp_bots (qr_instance) where qr_instance is not null;

-- endereço e chave do servidor Evolution (só a função "whatsapp" lê)
alter table public.platform_secrets add column if not exists evo_url text;
alter table public.platform_secrets add column if not exists evo_key text;
alter table public.platform_secrets add column if not exists evo_hook_secret text;
update public.platform_secrets set evo_hook_secret = encode(extensions.gen_random_bytes(24), 'hex') where id = 1 and evo_hook_secret is null;
