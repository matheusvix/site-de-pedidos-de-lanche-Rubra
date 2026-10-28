-- BoraLanchar! — nome da mesa sem repetir ("Mesa Mesa 1" -> "Mesa 1")
create or replace function public.table_display_name(p_kind text, p_label text) returns text language sql immutable as $f$
  select case when coalesce(p_label,'') ~* ('^' || case when p_kind = 'comanda' then 'comanda' else 'mesa' end || '\M') then p_label
              else case when p_kind = 'comanda' then 'Comanda ' else 'Mesa ' end || coalesce(p_label,'') end
$f$;
do $$
declare f oid; d text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='place_order' loop
    d := pg_get_functiondef(f);
    d := replace(d, $a$case when tb.kind = 'comanda' then 'Comanda ' else 'Mesa ' end || tb.label$a$, $b$public.table_display_name(tb.kind, tb.label)$b$);
    execute d;
  end loop;
end $$;
