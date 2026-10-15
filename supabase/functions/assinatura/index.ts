// BoraLanchar! — pagamento dos planos (o dinheiro vai para a conta do BoraLanchar!)
// Ações (corpo JSON "action" ou "?action="):
//   create   { public_id }  -> Pix (QR) ou link do Mercado Pago (cartão/boleto). Sem Mercado Pago no Pix: { mode: "manual" }
//   status   { public_id }  -> confere no Mercado Pago e ativa o plano quando aprovado
//   webhook                 -> aviso do Mercado Pago
//   connect / disconnect / account -> admin conecta a conta Mercado Pago da plataforma
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SITE = "https://boralanchar.netlify.app";
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const MP = "https://api.mercadopago.com";
const WEBHOOK = `${SUPABASE_URL}/functions/v1/assinatura?action=webhook`;

async function mp(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(MP + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: data as Record<string, any> };
}
async function platformToken(): Promise<string | null> {
  const { data } = await admin.from("platform_secrets").select("mp_access_token").eq("id", 1).maybeSingle();
  return data?.mp_access_token || null;
}
async function markPaid(id: number) {
  const { data } = await admin.rpc("mark_subscription_paid", { p_id: id });
  return data;
}
async function isAdminReq(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u } = await admin.auth.getUser(jwt);
  const email = (u?.user?.email || "").toLowerCase();
  if (!email) return false;
  const { data } = await admin.from("admins").select("email").ilike("email", email).maybeSingle();
  return !!data;
}
// procura no Mercado Pago um pagamento aprovado desta assinatura
async function findApproved(token: string, ref: string) {
  const r = await mp(token, `/v1/payments/search?external_reference=${encodeURIComponent(ref)}&sort=date_created&criteria=desc`);
  if (!r.ok) return null;
  return (r.data.results || []).find((p: any) => p.status === "approved") || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  let body: Record<string, any> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const action = String(url.searchParams.get("action") || body.action || "");

  try {
    if (action === "webhook") {
      const id = String(body?.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id") || "");
      const token = await platformToken();
      if (!token || !/^\d{1,20}$/.test(id)) return json({ ok: true });
      const r = await mp(token, `/v1/payments/${id}`); // confere direto no Mercado Pago
      const ref = String(r.data?.external_reference || "");
      if (r.ok && r.data.status === "approved" && ref.startsWith("sub:")) {
        const { data: sp } = await admin.from("subscription_payments").select("id, amount").eq("public_id", ref.slice(4)).maybeSingle();
        if (sp && Number(r.data.transaction_amount) >= Number(sp.amount) - 0.01) await markPaid(sp.id);
      }
      return json({ ok: true });
    }

    if (action === "create" || action === "status") {
      const pid = String(body.public_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(pid)) return json({ error: "Pagamento inválido" }, 400);
      const { data: sp } = await admin.from("subscription_payments").select("*").eq("public_id", pid).maybeSingle();
      if (!sp) return json({ error: "Pagamento não encontrado" }, 404);
      const token = await platformToken();
      const ref = `sub:${sp.public_id}`;

      if (action === "status") {
        if (sp.status === "pendente" && token) {
          const ok = await findApproved(token, ref);
          if (ok && Number(ok.transaction_amount) >= Number(sp.amount) - 0.01) { await markPaid(sp.id); return json({ status: "pago" }); }
        }
        return json({ status: sp.status });
      }

      if (sp.status !== "pendente") return json({ status: sp.status });
      const { data: rest } = await admin.from("restaurants").select("name").eq("id", sp.restaurant_id).single();
      const title = `BoraLanchar! plano ${sp.plan} (mensal) - ${rest?.name || ""}`.slice(0, 120);

      if (sp.method === "pix") {
        if (!token) return json({ mode: "manual" });
        const r = await mp(token, "/v1/payments", {
          method: "POST",
          headers: { "X-Idempotency-Key": sp.public_id },
          body: JSON.stringify({
            transaction_amount: Number(sp.amount), description: title, payment_method_id: "pix",
            external_reference: ref, notification_url: WEBHOOK,
            date_of_expiration: new Date(Date.now() + 60 * 60000).toISOString().replace("Z", "-00:00"),
            payer: { email: `assinatura.${sp.public_id.slice(0, 8)}@boralanchar.com.br` },
          }),
        });
        const td = r.data?.point_of_interaction?.transaction_data || {};
        if (!r.ok || !td.qr_code) return json({ mode: "manual", error: r.data?.message || "Mercado Pago indisponível" });
        await admin.from("subscription_payments").update({ mp_ref: String(r.data.id) }).eq("id", sp.id);
        return json({ mode: "auto", qr_code: td.qr_code });
      }

      // cartão ou boleto: página de pagamento segura do Mercado Pago
      if (!token) return json({ error: "Cartão e boleto ainda não estão disponíveis. Use o Pix ou fale com a gente." }, 400);
      const back = `${SITE}/assinar.html?ref=${sp.public_id}`;
      const excluded = sp.method === "cartao"
        ? [{ id: "ticket" }, { id: "bank_transfer" }, { id: "atm" }]
        : [{ id: "credit_card" }, { id: "debit_card" }, { id: "bank_transfer" }];
      const r = await mp(token, "/checkout/preferences", {
        method: "POST",
        body: JSON.stringify({
          items: [{ id: `plano-${sp.plan.toLowerCase()}`, title, quantity: 1, unit_price: Number(sp.amount), currency_id: "BRL" }],
          external_reference: ref, notification_url: WEBHOOK,
          back_urls: { success: back, pending: back, failure: back }, auto_return: "approved",
          payment_methods: { excluded_payment_types: excluded, installments: 1 },
          statement_descriptor: "BORALANCHAR",
        }),
      });
      if (!r.ok || !r.data.init_point) return json({ error: r.data?.message || "Não foi possível abrir o pagamento agora." }, 502);
      await admin.from("subscription_payments").update({ mp_ref: String(r.data.id).slice(0, 60) }).eq("id", sp.id);
      return json({ mode: "redirect", url: r.data.init_point });
    }

    if (["connect", "disconnect", "account"].includes(action)) {
      if (!(await isAdminReq(req))) return json({ error: "Só o administrador pode fazer isso." }, 401);
      if (action === "account") {
        const { data } = await admin.from("platform_secrets").select("mp_account, mp_access_token").eq("id", 1).maybeSingle();
        return json({ connected: !!data?.mp_access_token, account: data?.mp_account || null });
      }
      if (action === "disconnect") {
        await admin.from("platform_secrets").delete().eq("id", 1);
        await admin.from("platform_settings").update({ mp_enabled: false }).eq("id", 1);
        return json({ ok: true });
      }
      const token = String(body.token || "").trim();
      if (!/^APP_USR-[\w-]{20,}$/.test(token)) return json({ error: "Cole o Access Token de produção (começa com APP_USR-)." }, 400);
      const me = await mp(token, "/users/me");
      if (!me.ok) return json({ error: "O Mercado Pago não aceitou esse token. Confira se copiou inteiro." }, 400);
      const account = String(me.data.nickname || me.data.email || me.data.id || "conta conectada").slice(0, 80);
      await admin.from("platform_secrets").upsert({ id: 1, mp_access_token: token, mp_account: account, updated_at: new Date().toISOString() });
      await admin.from("platform_settings").update({ mp_enabled: true }).eq("id", 1);
      return json({ ok: true, account });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
