// BoraLanchar! — E-mail de "pedido novo" para o dono da loja (via Resend)
//
// Chamado pelo banco (gatilho email_aviso_pedido em public.orders) quando um pedido
// fica com status "novo" (pedido normal, ou Pix confirmado). Pedidos de mesa/garçom não avisam.
//   POST { order_id }   header x-bora-hook = platform_secrets.wa_hook_secret
// Segredos da função: RESEND_API_KEY
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://boralanchar.com.br";
const FROM = "BoraLanchar! <pedidos@boralanchar.com.br>";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const brl = (n: unknown) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const PAG: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão" };

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function row(label: string, value: string) {
  return `<tr><td style="padding:6px 0;color:#6E5C5D;font-size:14px;width:110px;vertical-align:top">${label}</td><td style="padding:6px 0;font-size:14px;color:#1A1112">${value}</td></tr>`;
}

function html(o: Record<string, any>, r: Record<string, any>) {
  const ent = o.mode === "entrega";
  const items = (o.items || []).map((i: any) => `
    <tr><td style="padding:8px 0;border-bottom:1px solid #F3E9E9;font-size:15px;color:#1A1112">
      <b>${Number(i.qty) || 1}×</b> ${esc(i.name)}
      ${(i.opts || []).length ? `<div style="font-size:13px;color:#6E5C5D">${(i.opts as string[]).map(esc).join(" · ")}</div>` : ""}
      ${i.note ? `<div style="font-size:13px;color:#6E5C5D">Obs.: ${esc(i.note)}</div>` : ""}
    </td><td align="right" style="padding:8px 0;border-bottom:1px solid #F3E9E9;font-size:15px;white-space:nowrap">${brl(Number(i.price) * (Number(i.qty) || 1))}</td></tr>`).join("");
  let pag = PAG[o.payment] || esc(o.payment);
  if (o.payment === "dinheiro" && Number(o.change_for) > 0) pag += ` (troco para ${brl(o.change_for)})`;
  if (o.payment === "pix") pag += o.paid ? " · recebido ✓" : " · confira no app do banco";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FBF7F6;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1112">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7F6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:24px;overflow:hidden;border:1px solid #EFE3E3">
<tr><td align="center" style="background:#E01E2D;padding:24px">
<img src="${SITE}/assets/app/email-logo.png" width="220" alt="BoraLanchar!" style="display:block;border:0;width:220px;height:auto;color:#FFFFFF;font-size:24px;font-weight:800">
</td></tr>
<tr><td style="padding:28px 28px 8px">
<p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#E01E2D;text-transform:uppercase;letter-spacing:.04em">${esc(r.name)}</p>
<h1 style="margin:0 0 6px;font-size:26px;line-height:1.2;font-weight:800">Pedido novo #${esc(o.number)} 🍔</h1>
<p style="margin:0 0 18px;font-size:15px;color:#5B4A4B">${esc(o.customer_name)} · ${ent ? "Entrega" : "Retirada no balcão"} · <b>${brl(o.total)}</b></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}
<tr><td style="padding:10px 0 0;font-size:16px;font-weight:800">Total${Number(o.fee) > 0 ? ` <span style="font-weight:400;font-size:13px;color:#6E5C5D">(com entrega ${brl(o.fee)})</span>` : ""}</td><td align="right" style="padding:10px 0 0;font-size:16px;font-weight:800">${brl(o.total)}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">
${ent ? row("Endereço", esc(o.address) + (o.delivery_info ? `<br><span style="color:#6E5C5D">${esc(o.delivery_info)}</span>` : "")) : ""}
${row("Pagamento", pag)}
${o.customer_phone ? row("WhatsApp", esc(o.customer_phone)) : ""}
${Number(o.discount) > 0 ? row("Desconto", "−" + brl(o.discount) + (o.coupon_code ? ` (cupom ${esc(o.coupon_code)})` : "")) : ""}
${o.notes ? row("Obs.", esc(o.notes)) : ""}
</table>
</td></tr>
<tr><td align="center" style="padding:22px 28px 30px">
<a href="${SITE}/painel" style="display:inline-block;background:#E01E2D;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:14px 30px;border-radius:999px">Abrir o painel e aceitar</a>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#9A8A8B">Você recebe este aviso porque é dono(a) da loja ${esc(r.name)} no BoraLanchar!.</p>
</td></tr></table></body></html>`;
}

async function avisar(orderId: number) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { skipped: "sem RESEND_API_KEY" };
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o || o.status !== "novo" || o.table_id) return { skipped: "pedido fora do aviso" };
  const { data: r } = await admin.from("restaurants").select("id, name, owner_id, email_new_order").eq("id", o.restaurant_id).maybeSingle();
  if (!r || r.email_new_order === false || !r.owner_id) return { skipped: "aviso desligado" };
  const { data: u } = await admin.auth.admin.getUserById(r.owner_id);
  const to = u?.user?.email;
  if (!to) return { skipped: "dono sem e-mail" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `pedido-novo-${o.id}` },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `Pedido novo #${o.number} · ${o.customer_name} · ${brl(o.total)}`,
      html: html(o, r),
      tags: [{ name: "tipo", value: "pedido_novo" }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("aviso-pedido resend:", res.status, out); return { error: out }; }
  return { sent: true, id: out.id };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const { data: plat } = await admin.from("platform_secrets").select("wa_hook_secret").eq("id", 1).maybeSingle();
    const s = plat?.wa_hook_secret || "";
    if (!s || !safeEqual(req.headers.get("x-bora-hook") || "", s)) return json({ error: "forbidden" }, 403);
    const b = await req.json().catch(() => ({}));
    return json(await avisar(Number(b.order_id) || 0));
  } catch (e) {
    console.error("aviso-pedido:", e);
    return json({ error: "Erro no servidor" }, 500);
  }
});
