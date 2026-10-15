// BoraLanchar! — Pix com confirmação automática (Mercado Pago)
// Ações (no corpo JSON "action" ou na URL "?action="):
//   create     { public_id }  -> gera o Pix do pedido (QR + copia e cola). Sem Mercado Pago: { mode: "manual" }
//   status     { public_id }  -> confere o pagamento e libera o pedido para a loja quando aprovado
//   webhook    ?r=<restaurante>   (chamado pelo Mercado Pago)
//   connect    { token }      -> dono conecta a conta (precisa estar logado)
//   disconnect / account      -> dono desconecta / consulta a conta conectada
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MP = "https://api.mercadopago.com";

async function mp(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(MP + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: data as Record<string, any> };
}

async function tokenFor(rid: string): Promise<string | null> {
  const { data } = await admin.from("restaurant_secrets").select("mp_access_token").eq("restaurant_id", rid).maybeSingle();
  return data?.mp_access_token || null;
}

async function release(orderId: number) {
  const { data } = await admin.rpc("release_order", { p_order_id: orderId, p_paid: true });
  return (data && data.status) || "novo";
}

// Pergunta ao Mercado Pago se o pagamento do pedido foi aprovado
async function checkOrder(o: Record<string, any>, token: string) {
  if (!o.mp_payment_id) return o.status;
  const r = await mp(token, `/v1/payments/${o.mp_payment_id}`);
  if (r.ok && r.data.status === "approved" && r.data.external_reference === o.public_id) return await release(o.id);
  return o.status;
}

async function ownerRestaurant(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: rest } = await admin.from("restaurants").select("id").eq("owner_id", u.user.id).maybeSingle();
  return rest;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  let body: Record<string, any> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const action = String(url.searchParams.get("action") || body.action || "");

  try {
    /* ---------- aviso do Mercado Pago ---------- */
    if (action === "webhook") {
      const rid = url.searchParams.get("r") || "";
      const id = String(body?.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
      if (!/^[0-9a-f-]{36}$/i.test(rid) || !/^\d{1,20}$/.test(id)) return json({ ok: true });
      const token = await tokenFor(rid);
      if (!token) return json({ ok: true });
      const r = await mp(token, `/v1/payments/${id}`); // confirma direto no Mercado Pago (não confia no aviso)
      if (r.ok && r.data.status === "approved" && r.data.external_reference) {
        const { data: o } = await admin.from("orders").select("id, mp_payment_id")
          .eq("public_id", r.data.external_reference).eq("restaurant_id", rid).maybeSingle();
        if (o && String(o.mp_payment_id) === id) await release(o.id);
      }
      return json({ ok: true });
    }

    /* ---------- cliente: gerar Pix / conferir pagamento ---------- */
    if (action === "create" || action === "status") {
      const pid = String(body.public_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(pid)) return json({ error: "Pedido inválido" }, 400);
      const { data: o } = await admin.from("orders").select("*").eq("public_id", pid).maybeSingle();
      if (!o) return json({ error: "Pedido não encontrado" }, 404);
      const token = await tokenFor(o.restaurant_id);

      if (action === "status") {
        const st = o.status === "pagamento" && token ? await checkOrder(o, token) : o.status;
        return json({ status: st, paid: st !== "pagamento" ? true : o.paid });
      }

      if (!token) return json({ mode: "manual" });
      if (o.status !== "pagamento") return json({ mode: "auto", status: o.status });

      let pay: Record<string, any> | null = null;
      if (o.mp_payment_id) {
        const r = await mp(token, `/v1/payments/${o.mp_payment_id}`);
        if (r.ok) pay = r.data;
      }
      if (pay && pay.status === "approved") return json({ mode: "auto", status: await release(o.id) });
      if (!pay || !["pending", "in_process"].includes(pay.status)) {
        const { data: rest } = await admin.from("restaurants").select("name").eq("id", o.restaurant_id).single();
        const exp = new Date(Date.now() + 30 * 60000).toISOString().replace("Z", "-00:00");
        const r = await mp(token, "/v1/payments", {
          method: "POST",
          headers: { "X-Idempotency-Key": `${o.public_id}-${o.mp_payment_id || 0}` },
          body: JSON.stringify({
            transaction_amount: Number(o.total),
            description: `Pedido ${rest?.name || ""}`.slice(0, 60),
            payment_method_id: "pix",
            external_reference: o.public_id,
            notification_url: `${SUPABASE_URL}/functions/v1/pix?action=webhook&r=${o.restaurant_id}`,
            date_of_expiration: exp,
            payer: { email: `pedido.${o.public_id.slice(0, 8)}@boralanchar.com.br`, first_name: String(o.customer_name || "Cliente").split(" ")[0] },
          }),
        });
        if (!r.ok) return json({ mode: "manual", error: r.data?.message || "Mercado Pago indisponível" });
        pay = r.data;
        await admin.from("orders").update({ mp_payment_id: String(pay.id) }).eq("id", o.id);
      }
      const td = pay.point_of_interaction?.transaction_data || {};
      if (!td.qr_code) return json({ mode: "manual", error: "Mercado Pago não devolveu o QR Code" });
      return json({ mode: "auto", qr_code: td.qr_code, expires: pay.date_of_expiration });
    }

    /* ---------- dono: conectar Mercado Pago ---------- */
    if (["connect", "disconnect", "account"].includes(action)) {
      const rest = await ownerRestaurant(req);
      if (!rest) return json({ error: "Entre de novo no painel para continuar." }, 401);
      if (action === "account") {
        const { data } = await admin.from("restaurant_secrets").select("mp_account, mp_access_token").eq("restaurant_id", rest.id).maybeSingle();
        return json({ connected: !!data?.mp_access_token, account: data?.mp_account || null });
      }
      if (action === "disconnect") {
        await admin.from("restaurant_secrets").delete().eq("restaurant_id", rest.id);
        await admin.from("restaurants").update({ pix_auto: false }).eq("id", rest.id);
        return json({ ok: true });
      }
      const token = String(body.token || "").trim();
      if (!/^APP_USR-[\w-]{20,}$/.test(token)) return json({ error: "Cole o Access Token de produção do Mercado Pago (começa com APP_USR-)." }, 400);
      const me = await mp(token, "/users/me");
      if (!me.ok) return json({ error: "O Mercado Pago não aceitou esse token. Confira se copiou inteiro." }, 400);
      const account = String(me.data.nickname || me.data.email || me.data.id || "conta conectada").slice(0, 80);
      await admin.from("restaurant_secrets").upsert({ restaurant_id: rest.id, mp_access_token: token, mp_account: account, updated_at: new Date().toISOString() });
      await admin.from("restaurants").update({ pix_auto: true }).eq("id", rest.id);
      return json({ ok: true, account });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
