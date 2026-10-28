// BoraLanchar! — Colaboradores da loja (só o dono da loja)
// POST (Authorization: Bearer <jwt do dono>) corpo JSON:
//   { action: "create", name, email, password, role }
//   { action: "update", id, name?, role?, active?, password? }
//   { action: "delete", id }
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const ROLES = ["gerente", "atendente", "cozinha"];
const MAX = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (!u?.user) return json({ error: "Entre de novo no painel para continuar." }, 401);
    const { data: R } = await admin.from("restaurants").select("id, name").eq("owner_id", u.user.id).maybeSingle();
    if (!R) return json({ error: "Só o dono da loja cadastra colaboradores." }, 403);

    const b = await req.json().catch(() => ({}));
    const name = String(b.name || "").trim().slice(0, 60);
    const role = String(b.role || "");
    const password = String(b.password || "");

    if (b.action === "create") {
      const email = String(b.email || "").trim().toLowerCase();
      if (!name) return json({ error: "Informe o nome." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "E-mail inválido." }, 400);
      if (!ROLES.includes(role)) return json({ error: "Escolha a função." }, 400);
      if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const { count } = await admin.from("restaurant_staff").select("id", { count: "exact", head: true }).eq("restaurant_id", R.id);
      if ((count || 0) >= MAX) return json({ error: `Limite de ${MAX} colaboradores por loja.` }, 400);
      if (email === String(u.user.email || "").toLowerCase()) return json({ error: "Esse é o seu próprio e-mail." }, 400);
      const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { staff: true, name, loja: R.name } });
      if (cu.error || !cu.data.user) {
        const taken = /already|registered|exists/i.test(cu.error?.message || "");
        return json({ error: taken ? "Este e-mail já tem conta no BoraLanchar!. Use outro e-mail para o colaborador." : "Não foi possível criar a conta." }, 400);
      }
      const ins = await admin.from("restaurant_staff").insert({ restaurant_id: R.id, user_id: cu.data.user.id, name, email, role }).select().single();
      if (ins.error) { await admin.auth.admin.deleteUser(cu.data.user.id); return json({ error: "Não foi possível salvar o colaborador." }, 500); }
      return json({ ok: true, staff: ins.data });
    }

    const id = Number(b.id) || 0;
    const { data: st } = await admin.from("restaurant_staff").select("*").eq("id", id).eq("restaurant_id", R.id).maybeSingle();
    if (!st) return json({ error: "Colaborador não encontrado." }, 404);

    if (b.action === "update") {
      const patch: Record<string, unknown> = {};
      if (name) patch.name = name;
      if (role) { if (!ROLES.includes(role)) return json({ error: "Função inválida." }, 400); patch.role = role; }
      if (typeof b.active === "boolean") patch.active = b.active;
      if (password) {
        if (password.length < 8) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
        const up = await admin.auth.admin.updateUserById(st.user_id, { password });
        if (up.error) return json({ error: "Não foi possível trocar a senha." }, 400);
      }
      const { data, error } = await admin.from("restaurant_staff").update(patch).eq("id", id).select().single();
      if (error) return json({ error: "Não foi possível salvar." }, 500);
      return json({ ok: true, staff: data });
    }

    if (b.action === "delete") {
      await admin.from("restaurant_staff").delete().eq("id", id);
      // a conta só existe para trabalhar nesta loja: apaga também
      const { data: other } = await admin.from("restaurants").select("id").eq("owner_id", st.user_id).maybeSingle();
      if (!other) await admin.auth.admin.deleteUser(st.user_id);
      return json({ ok: true });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    console.error("equipe:", e);
    return json({ error: "Erro no servidor" }, 500);
  }
});
