// BoraLanchar! — excluir loja (só o administrador)
// POST { action: "delete", restaurant_id, confirm_name, delete_account }
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function isAdminEmail(email: string) {
  if (!email) return false;
  const { data } = await admin.from("admins").select("email").ilike("email", email).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (!u?.user || !(await isAdminEmail(u.user.email || ""))) return json({ error: "Só o administrador pode fazer isso." }, 401);

    const body = await req.json().catch(() => ({}));
    if (body.action !== "delete") return json({ error: "Ação inválida" }, 400);
    const rid = String(body.restaurant_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(rid)) return json({ error: "Loja inválida" }, 400);

    const { data: r } = await admin.from("restaurants").select("id, name, owner_id").eq("id", rid).maybeSingle();
    if (!r) return json({ error: "Loja não encontrada" }, 404);
    if (String(body.confirm_name || "").trim().toLowerCase() !== String(r.name).trim().toLowerCase())
      return json({ error: "O nome digitado não confere com o nome da loja." }, 400);

    // fotos da loja (pasta <id>/ no armazenamento)
    let removed = 0;
    for (let i = 0; i < 20; i++) {
      const { data: files } = await admin.storage.from("produtos").list(rid, { limit: 100 });
      if (!files || !files.length) break;
      await admin.storage.from("produtos").remove(files.map((f) => `${rid}/${f.name}`));
      removed += files.length;
    }

    // loja + cardápio + pedidos + pagamentos (apagam juntos)
    const { error } = await admin.from("restaurants").delete().eq("id", rid);
    if (error) return json({ error: "Não foi possível excluir: " + error.message }, 500);

    let accountDeleted = false;
    if (body.delete_account && r.owner_id) {
      const { data: owner } = await admin.auth.admin.getUserById(r.owner_id);
      const email = owner?.user?.email || "";
      if (owner?.user && !(await isAdminEmail(email))) {
        const del = await admin.auth.admin.deleteUser(r.owner_id);
        accountDeleted = !del.error;
      }
    }
    return json({ ok: true, deleted: r.name, photos_removed: removed, account_deleted: accountDeleted });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
