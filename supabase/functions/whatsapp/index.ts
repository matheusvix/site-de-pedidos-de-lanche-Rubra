// BoraLanchar! — Robô de atendimento no WhatsApp (API oficial da Meta / WhatsApp Cloud API)
//
// Endereço (Callback URL na Meta): https://<projeto>.supabase.co/functions/v1/whatsapp
//   GET  ?hub.mode=subscribe...      -> verificação do webhook pela Meta
//   POST (corpo da Meta)             -> mensagens recebidas: o robô responde
//   POST ?action=notify              -> aviso de status do pedido (chamado pelo banco, header x-bora-hook)
// Ações do dono da loja (logado, Authorization: Bearer <jwt>), corpo JSON { action }:
//   account | connect { phone_number_id, waba_id, token, app_secret? } | disconnect
//   send { conversation_id, text } | test { to }
import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const SITE = "https://boralanchar.com.br";
const planRobo = (plan: string) => ["Profissional", "Completo"].includes(String(plan || ""));

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Row = Record<string, any>;

/* ---------------- utilidades ---------------- */
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const brl = (n: unknown) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\w\s?]/g, " ").replace(/\s+/g, " ").trim();
const first = (name: unknown) => String(name || "").trim().split(/\s+/)[0] || "";
const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function platform(): Promise<Row> {
  const { data } = await admin.from("platform_secrets").select("wa_verify_token, wa_app_secret, wa_hook_secret").eq("id", 1).maybeSingle();
  return data || {};
}
async function secretsFor(rid: string): Promise<Row> {
  const { data } = await admin.from("restaurant_secrets").select("wa_token, wa_app_secret").eq("restaurant_id", rid).maybeSingle();
  return data || {};
}

async function graph(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(GRAPH + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: data as Row };
}
const metaError = (d: Row) => String(d?.error?.error_user_msg || d?.error?.message || "erro desconhecido").slice(0, 300);

/* ---------------- horário (mesma regra do assets/horario.js) ---------------- */
const CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const toMin = (s: string) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const hhmm = (s: string) => String(s).slice(0, 5);
function spNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { d: WD[p.weekday] ?? 0, m: (+p.hour % 24) * 60 + +p.minute };
}
const ivList = (H: Row | null, d: number): string[][] => ((H && H[String(d)]) || []).filter((iv: string[]) => iv && iv[0] && iv[1]);
function openNow(R: Row, now = spNow()) {
  if (!R.is_open) return false;
  const H = R.opening_hours; if (!H) return true;
  for (const [a, b] of ivList(H, now.d)) { const s = toMin(a), e = toMin(b); if (e > s ? now.m >= s && now.m < e : now.m >= s) return true; }
  for (const [a, b] of ivList(H, (now.d + 6) % 7)) { const s = toMin(a), e = toMin(b); if (e <= s && now.m < e) return true; }
  return false;
}
function statusText(R: Row, now = spNow()) {
  const H = R.opening_hours;
  if (!R.is_open) return { open: false, text: "Estamos fechados agora" };
  if (!H) return { open: true, text: "Estamos abertos agora" };
  if (openNow(R, now)) {
    for (const [a, b] of ivList(H, now.d)) {
      const s = toMin(a), e = toMin(b);
      if (s === e) return { open: true, text: "Estamos abertos 24 horas" };
      if (e > s ? now.m >= s && now.m < e : now.m >= s) return { open: true, text: `Estamos abertos até as ${hhmm(b)}` };
    }
    for (const [, b] of ivList(H, (now.d + 6) % 7)) return { open: true, text: `Estamos abertos até as ${hhmm(b)}` };
    return { open: true, text: "Estamos abertos agora" };
  }
  for (let k = 0; k <= 7; k++) {
    const d = (now.d + k) % 7;
    const ivs = ivList(H, d).map(([a]) => toMin(a)).sort((x, y) => x - y).filter((s) => k > 0 || s > now.m);
    if (ivs.length) {
      const t = `${String(Math.floor(ivs[0] / 60)).padStart(2, "0")}:${String(ivs[0] % 60).padStart(2, "0")}`;
      return { open: false, text: `Estamos fechados agora. Abrimos ${k === 0 ? "hoje" : k === 1 ? "amanhã" : CURTO[d]} às ${t}` };
    }
  }
  return { open: false, text: "Estamos fechados agora" };
}
function weekText(R: Row) {
  const H = R.opening_hours;
  if (!H) return R.is_open ? "Atendemos sem horário fixo. Quando a loja está aberta, o cardápio recebe pedidos." : "No momento a loja está fechada.";
  return [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const ivs = ivList(H, d);
    const t = !ivs.length ? "fechado" : ivs.some(([a, b]) => toMin(a) === toMin(b)) ? "24 horas" : ivs.map(([a, b]) => `${hhmm(a)} às ${hhmm(b)}`).join(" e ");
    return `• ${DIAS[d]}: ${t}`;
  }).join("\n");
}
const canSell = (R: Row) => {
  const paidOk = !R.paid_until || new Date(R.paid_until).getTime() > Date.now() - 3 * 86400000;
  return (R.status === "ativo" && paidOk) || (R.status === "teste" && new Date(R.trial_ends_at).getTime() > Date.now());
};
const link = (R: Row) => `${SITE}/l/${R.slug}`;

/* ---------------- respostas do robô ---------------- */
const ST: Record<string, string> = {
  pagamento: "aguardando a confirmação do Pix 💠",
  novo: "recebido ✅ e aguardando a loja aceitar",
  preparo: "em preparo 👨‍🍳",
  pronto: "pronto para retirada no balcão ✅",
  saiu: "a caminho 🛵",
  entregue: "entregue 😋",
  cancelado: "cancelado",
};
const PAG: Record<string, string> = { pix: "Pix", cartao: "Cartão (maquininha na entrega ou no balcão)", dinheiro: "Dinheiro" };

const MENU = [
  { id: "m_cardapio", title: "📋 Ver cardápio", description: "Faça seu pedido pelo nosso cardápio digital" },
  { id: "m_status", title: "🛵 Meu pedido", description: "Veja como está o seu último pedido" },
  { id: "m_horario", title: "🕒 Horário", description: "Dias e horários de funcionamento" },
  { id: "m_entrega", title: "📍 Entrega e taxa", description: "Bairros, taxa, prazo e retirada" },
  { id: "m_pagamento", title: "💳 Pagamento", description: "Formas de pagamento aceitas" },
  { id: "m_humano", title: "🙋 Falar com atendente", description: "Chamar alguém da loja" },
];

function detect(t: string): string | null {
  if (/^1$/.test(t)) return "m_cardapio";
  if (/^2$/.test(t)) return "m_status";
  if (/^3$/.test(t)) return "m_horario";
  if (/^4$/.test(t)) return "m_entrega";
  if (/^5$/.test(t)) return "m_pagamento";
  if (/^6$/.test(t)) return "m_humano";
  if (/^(0|menu|opcoes|inicio|voltar)$/.test(t)) return "m_menu";
  if (/\b(atendente|humano|pessoa|alguem da loja|falar com|reclama|problema)\b/.test(t)) return "m_humano";
  if (/\b(meu pedido|status|cade|demora|chega|chegando|saiu|acompanhar|ja saiu)\b/.test(t)) return "m_status";
  if (/\b(cardapio|menu|pedir|pedido|quero|tem |preco|valor|lanche|hamburguer|pizza)\b/.test(t)) return "m_cardapio";
  if (/\b(horarios?|abert[oa]s?|abre|abrem|fecha|fecham|funciona\w*|que horas|ate que horas|hoje)\b/.test(t)) return "m_horario";
  if (/\b(entrega|entregam|taxa|frete|bairro|delivery|retirar|retirada|buscar)\b/.test(t)) return "m_entrega";
  if (/\b(pagamento|pix|cartao|dinheiro|pagar|troco|credito|debito)\b/.test(t)) return "m_pagamento";
  if (/^(oi+|ola|opa|eae|eai|e ai|bom dia|boa tarde|boa noite|hey|hello|salve)\b/.test(t)) return "m_oi";
  return null;
}

function faqMatch(t: string, faq: Row[]): string | null {
  for (const f of faq || []) {
    const keys = String(f.keys || "").split(",").map((k) => norm(k)).filter((k) => k.length >= 2);
    if (keys.some((k) => (` ${t} `).includes(` ${k} `) || (k.length >= 5 && t.includes(k)))) return String(f.answer || "").trim() || null;
  }
  return null;
}

function deliveryText(R: Row) {
  const out: string[] = [];
  if (R.accepts_delivery) {
    if (R.delivery_mode === "bairro" && (R.delivery_zones || []).length) {
      out.push("🛵 *Entregamos nestes bairros:*");
      for (const z of R.delivery_zones.slice(0, 40)) out.push(`• ${z.name}: ${Number(z.fee) > 0 ? brl(z.fee) : "grátis"}${z.time ? ` (${z.time})` : ""}`);
    } else if (R.delivery_mode === "distancia" && (R.delivery_zones || []).length) {
      out.push("🛵 *Taxa de entrega por distância:*");
      for (const z of R.delivery_zones) out.push(`• Até ${String(z.km).replace(".", ",")} km: ${Number(z.fee) > 0 ? brl(z.fee) : "grátis"}${z.time ? ` (${z.time})` : ""}`);
      out.push("O valor certo aparece no cardápio quando você coloca o endereço.");
    } else {
      out.push(`🛵 *Entrega:* ${Number(R.delivery_fee) > 0 ? `taxa de ${brl(R.delivery_fee)}` : "grátis"}${R.delivery_time ? `, em média ${R.delivery_time}` : ""}.`);
    }
  } else out.push("No momento não fazemos entrega.");
  if (R.accepts_pickup) out.push(`🏪 *Retirada no balcão:* sim${R.address ? `, em ${R.address}` : ""}.`);
  if (Number(R.min_order) > 0) out.push(`Pedido mínimo: ${brl(R.min_order)}.`);
  return out.join("\n");
}

async function lastOrder(R: Row, waId: string) {
  const since = new Date(Date.now() - 2 * 86400000).toISOString();
  const { data } = await admin.from("orders").select("number, status, total, mode, created_at, customer_phone, customer_name")
    .eq("restaurant_id", R.id).gte("created_at", since).order("created_at", { ascending: false }).limit(200);
  const tail = waId.slice(-8);
  return (data || []).find((o: Row) => digits(o.customer_phone).slice(-8) === tail) || null;
}

/* ---------------- envio ---------------- */
// Celular brasileiro: o WhatsApp manda o wa_id sem o 9 (55 + DDD + 8 dígitos).
// Respondemos com o 9 (55 + DDD + 9 + 8 dígitos), que é o formato aceito em todos os casos.
const toAddr = (waId: string) => (/^55\d{2}[6-9]\d{7}$/.test(waId) ? waId.slice(0, 4) + "9" + waId.slice(4) : waId);

async function send(bot: Row, token: string, conv: Row, payload: Row, logBody: string, sender = "robo") {
  const r = await graph(token, `/${bot.phone_number_id}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: toAddr(conv.wa_id), ...payload }),
  });
  const id = r.ok ? String(r.data?.messages?.[0]?.id || "") || null : null;
  await admin.from("wa_messages").insert({
    conversation_id: conv.id, restaurant_id: bot.restaurant_id, direction: "out", sender,
    body: (r.ok ? logBody : `⚠️ Não enviado: ${metaError(r.data)}\n${logBody}`).slice(0, 4096), wa_msg_id: id, status: r.ok ? "sent" : "failed",
  });
  await admin.from("wa_conversations").update({ last_msg_at: new Date().toISOString() }).eq("id", conv.id);
  return r;
}
const sendText = (bot: Row, token: string, conv: Row, text: string, sender = "robo") =>
  send(bot, token, conv, { type: "text", text: { body: text.slice(0, 4096), preview_url: true } }, text, sender);

function sendMenu(bot: Row, token: string, conv: Row, intro: string) {
  const body = `${intro}\n\nEscolha uma opção abaixo 👇 (ou digite o número)`.slice(0, 1024);
  const list = MENU.map((m, i) => `${i + 1}. ${m.title.replace(/^\S+\s/, "")}`).join("\n");
  return send(bot, token, conv, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      footer: { text: "Atendimento automático · BoraLanchar!" },
      action: { button: "Ver opções", sections: [{ title: "Como posso ajudar?", rows: MENU.map((m) => ({ id: m.id, title: m.title.slice(0, 24), description: m.description.slice(0, 72) })) }] },
    },
  }, `${body}\n${list}`);
}

/* ---------------- conversa com o cliente ---------------- */
async function handleMessage(bot: Row, R: Row, token: string, msg: Row, contact: Row | undefined) {
  const waId = digits(msg.from);
  if (!waId) return;
  const now = new Date().toISOString();
  const name = String(contact?.profile?.name || "").slice(0, 120) || null;

  // conversa (um contato por loja)
  let { data: conv } = await admin.from("wa_conversations").select("*").eq("restaurant_id", R.id).eq("wa_id", waId).maybeSingle();
  const isNewSession = !conv || !conv.last_inbound_at || Date.now() - new Date(conv.last_inbound_at).getTime() > 6 * 3600e3;
  if (!conv) {
    const ins = await admin.from("wa_conversations").insert({ restaurant_id: R.id, wa_id: waId, name }).select().single();
    conv = ins.data || (await admin.from("wa_conversations").select("*").eq("restaurant_id", R.id).eq("wa_id", waId).single()).data;
  }
  if (!conv) return;

  // texto que o cliente mandou
  let text = "", choice: string | null = null;
  if (msg.type === "text") text = String(msg.text?.body || "");
  else if (msg.type === "interactive") { choice = String(msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || ""); text = String(msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || ""); }
  else if (msg.type === "button") text = String(msg.button?.text || "");
  else text = `[${msg.type === "image" ? "foto" : msg.type === "audio" ? "áudio" : msg.type === "location" ? "localização" : msg.type === "sticker" ? "figurinha" : msg.type}]`;

  // guarda a mensagem (o id da Meta é único: aviso repetido não responde duas vezes)
  const saved = await admin.from("wa_messages").insert({
    conversation_id: conv.id, restaurant_id: R.id, direction: "in", sender: "cliente", body: text.slice(0, 4096), wa_msg_id: String(msg.id || "").slice(0, 200) || null,
  });
  if (saved.error) return; // já processada
  await admin.rpc("wa_touch_inbound", { p_conv: conv.id, p_name: name || "" }); // soma 1 em "não lidas" sem perder mensagens que chegam juntas
  conv.last_inbound_at = now;

  // marca como lida (os dois tracinhos azuis)
  if (msg.id) graph(token, `/${bot.phone_number_id}/messages`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: msg.id }) }).catch(() => {});

  if (!bot.enabled || !planRobo(R.plan)) return; // robô só nos planos Profissional e Completo
  if (conv.human_until && new Date(conv.human_until).getTime() > Date.now()) return; // atendente da loja está cuidando

  const t = norm(text);
  const nm = first(conv.name || name);
  const vars = { nome: nm, loja: R.name, link: link(R) };
  const st = statusText(R);
  let intent = choice && MENU.some((m) => m.id === choice) ? choice : (/^[0-6]$/.test(t) ? detect(t) : null);

  // perguntas frequentes da loja vêm antes das respostas padrão
  if (!intent && msg.type === "text") {
    const a = faqMatch(t, bot.faq || []);
    if (a) { await sendText(bot, token, conv, fill(a, vars)); return; }
  }
  if (!intent) intent = msg.type === "text" ? detect(t) : null;

  const greeting = bot.greeting
    ? fill(bot.greeting, vars)
    : `Olá${nm ? `, ${nm}` : ""}! 👋 Bem-vindo(a) à *${R.name}*. Eu sou o atendente automático e te ajudo por aqui.`;
  const away = !st.open ? `\n\n🔒 ${fill(bot.away_text || st.text + ". Você já pode ver o cardápio e pedir quando abrirmos.", vars)}` : "";

  switch (intent) {
    case "m_cardapio": {
      const sell = canSell(R);
      const head = !sell ? "No momento nosso cardápio digital está pausado. Chame um atendente (opção 6) que a gente te ajuda." :
        st.open ? `É só tocar no link, montar sua sacola e finalizar 😋\n👉 ${link(R)}` :
        `🔒 ${st.text}.\nMas você já pode olhar o cardápio:\n👉 ${link(R)}`;
      await sendText(bot, token, conv, `📋 *Cardápio da ${R.name}*\n${head}`);
      return;
    }
    case "m_status": {
      const o = await lastOrder(R, waId);
      if (!o) { await sendText(bot, token, conv, `Não encontrei pedido recente feito com este número 🤔\nSe você pediu com outro telefone, digite *6* para falar com um atendente.\n\nPara fazer um pedido: ${link(R)}`); return; }
      const when = new Date(o.created_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      await sendText(bot, token, conv, `🧾 *Pedido${o.number ? ` #${o.number}` : ""}* (feito às ${when}, ${brl(o.total)})\nStatus: *${ST[o.status] || o.status}*${o.status === "preparo" && o.mode === "entrega" && R.delivery_time ? `\nTempo médio de entrega: ${R.delivery_time}.` : ""}\n\nTe aviso por aqui quando mudar. Precisa de algo? Digite *6* para falar com a loja.`);
      return;
    }
    case "m_horario":
      await sendText(bot, token, conv, `🕒 *${st.text}.*\n\n*Horário de funcionamento:*\n${weekText(R)}`);
      return;
    case "m_entrega":
      await sendText(bot, token, conv, `${deliveryText(R)}\n\nPara pedir: ${link(R)}`);
      return;
    case "m_pagamento": {
      const pm = (R.payment_methods || []).map((k: string) => `• ${PAG[k] || k}`).join("\n");
      await sendText(bot, token, conv, `💳 *Formas de pagamento:*\n${pm}${(R.payment_methods || []).includes("pix") ? "\n\nNo Pix, o QR Code e o copia e cola já vêm com o valor certo ao finalizar o pedido." : ""}`);
      return;
    }
    case "m_humano": {
      const until = new Date(Date.now() + (bot.human_minutes || 120) * 60000).toISOString();
      await admin.from("wa_conversations").update({ human_until: until }).eq("id", conv.id);
      await sendText(bot, token, conv, st.open
        ? "Certo! 🙋 Já chamei alguém da loja para falar com você. Pode mandar sua mensagem aqui que logo te respondemos."
        : `Certo! 🙋 Deixei seu recado para a equipe.${away} Assim que possível alguém te responde por aqui.`);
      return;
    }
    case "m_oi":
    case "m_menu":
      await sendMenu(bot, token, conv, intent === "m_oi" || isNewSession ? `${greeting}${away}` : "Como posso te ajudar? 😊");
      return;
    default:
      await sendMenu(bot, token, conv, isNewSession ? `${greeting}${away}` : "Desculpe, não entendi bem 🤔");
  }
}

async function handleWebhook(raw: string, sig: string) {
  let body: Row; try { body = JSON.parse(raw); } catch { return; }
  if (body.object !== "whatsapp_business_account") return;
  const plat = await platform();
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const pnid = String(v.metadata?.phone_number_id || "");
      if (!pnid) continue;
      const { data: bot } = await admin.from("whatsapp_bots").select("*").eq("phone_number_id", pnid).maybeSingle();
      if (!bot) continue;
      const sec = await secretsFor(bot.restaurant_id);
      const appSecret = sec.wa_app_secret || plat.wa_app_secret;
      if (!appSecret || !sec.wa_token) { console.warn("whatsapp: loja sem app secret/token", bot.restaurant_id); continue; }
      if (!safeEqual(sig, "sha256=" + (await hmacHex(appSecret, raw)))) { console.warn("whatsapp: assinatura inválida"); continue; }

      // confirmações de entrega/leitura das mensagens enviadas
      for (const s of v.statuses || []) {
        if (!s.id) continue;
        const st = String(s.status || "").slice(0, 20);
        const err = (s.errors || [])[0];
        if (st === "failed" && err) {
          // guarda o motivo da falha para aparecer no painel
          const { data: m } = await admin.from("wa_messages").select("body").eq("wa_msg_id", String(s.id)).maybeSingle();
          const why = `⚠️ Não entregue: (#${err.code}) ${err.error_data?.details || err.message || err.title || ""}`.slice(0, 400);
          await admin.from("wa_messages").update({ status: st, body: `${why}\n${m?.body || ""}`.slice(0, 4096) }).eq("wa_msg_id", String(s.id));
          console.warn("whatsapp: falha na entrega", JSON.stringify(err));
        } else {
          await admin.from("wa_messages").update({ status: st }).eq("wa_msg_id", String(s.id));
        }
      }
      if (!(v.messages || []).length) continue;
      const { data: R } = await admin.from("restaurants").select("*").eq("id", bot.restaurant_id).maybeSingle();
      if (!R) continue;
      for (const m of v.messages) {
        const contact = (v.contacts || []).find((c: Row) => c.wa_id === m.from) || (v.contacts || [])[0];
        try { await handleMessage(bot, R, sec.wa_token, m, contact); } catch (e) { console.error("whatsapp: erro ao responder", e); }
      }
    }
  }
}

/* ---------------- aviso de status do pedido ---------------- */
async function notify(orderId: number, status: string) {
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o || o.status !== status || !ST[status] || status === "pagamento") return { skipped: "status" };
  if (o.mode === "mesa") return { skipped: "pedido na mesa" };
  const { data: bot } = await admin.from("whatsapp_bots").select("*").eq("restaurant_id", o.restaurant_id).maybeSingle();
  if (!bot || !bot.enabled || !bot.notify_status || !bot.phone_number_id) return { skipped: "robô desligado" };
  const sec = await secretsFor(o.restaurant_id);
  if (!sec.wa_token) return { skipped: "sem token" };
  const { data: R } = await admin.from("restaurants").select("*").eq("id", o.restaurant_id).single();
  if (!planRobo(R.plan)) return { skipped: "plano sem robô" };

  let d = digits(o.customer_phone); if (d.length <= 11) d = "55" + d;
  const tail = d.slice(-8);
  const { data: convs } = await admin.from("wa_conversations").select("*").eq("restaurant_id", R.id).like("wa_id", `%${tail}`).order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(1);
  let conv = convs?.[0];
  if (!conv) {
    const ins = await admin.from("wa_conversations").insert({ restaurant_id: R.id, wa_id: d, name: String(o.customer_name || "").slice(0, 120) }).select().single();
    conv = ins.data; if (!conv) return { skipped: "conversa" };
  }
  const nm = first(o.customer_name);
  const msg: Record<string, string> = {
    novo: `Oi${nm ? `, ${nm}` : ""}! 🧾 Recebemos seu pedido *#${o.number}* na *${R.name}* (${brl(o.total)}). Já já a loja confirma!`,
    preparo: `👨‍🍳 Seu pedido *#${o.number}* foi aceito e já está em preparo na *${R.name}*.`,
    pronto: `✅ Seu pedido *#${o.number}* está pronto! Pode vir retirar na *${R.name}*.`,
    saiu: `🛵 Seu pedido *#${o.number}* saiu para entrega. Já já chega aí!`,
    entregue: `😋 Pedido *#${o.number}* entregue. Obrigado por pedir na *${R.name}*! Bom apetite.`,
    cancelado: `Seu pedido *#${o.number}* na *${R.name}* foi cancelado. Se tiver dúvida, responda esta mensagem com *6* para falar com a loja.`,
  };
  const inWindow = conv.last_inbound_at && Date.now() - new Date(conv.last_inbound_at).getTime() < 23.5 * 3600e3;
  if (inWindow) { await sendText(bot, sec.wa_token, conv, msg[status], "aviso"); return { sent: "texto" }; }
  if (!bot.template_name) return { skipped: "fora da janela de 24h e sem modelo aprovado" };
  // fora da janela de 24h o WhatsApp só aceita modelo (template) aprovado pela Meta
  // modelo sugerido: "Olá, {{1}}! Seu pedido #{{2}} na {{4}} está {{3}}."
  const STP: Record<string, string> = { novo: "recebido", preparo: "em preparo", pronto: "pronto para retirada", saiu: "a caminho", entregue: "entregue", cancelado: "cancelado" };
  const params = [nm || "cliente", String(o.number || ""), STP[status] || status, R.name];
  await send(bot, sec.wa_token, conv, {
    type: "template",
    template: { name: bot.template_name, language: { code: bot.template_lang || "pt_BR" }, components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] },
  }, msg[status], "aviso");
  return { sent: "modelo" };
}

/* ---------------- dono da loja ---------------- */
async function ownerRestaurant(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: rest } = await admin.from("restaurants").select("*").eq("owner_id", u.user.id).maybeSingle();
  return rest;
}

async function ownerAction(req: Request, action: string, body: Row) {
  const R = await ownerRestaurant(req);
  if (!R) return json({ error: "Entre de novo no painel para continuar." }, 401);
  if (action !== "account" && !planRobo(R.plan)) return json({ error: "O robô de atendimento faz parte dos planos Profissional e Completo." }, 403);
  await admin.from("whatsapp_bots").upsert({ restaurant_id: R.id }, { onConflict: "restaurant_id", ignoreDuplicates: true });
  const { data: bot } = await admin.from("whatsapp_bots").select("*").eq("restaurant_id", R.id).single();
  const sec = await secretsFor(R.id);

  if (action === "account") {
    const plat = await platform();
    return json({
      connected: !!(bot.phone_number_id && sec.wa_token), display_phone: bot.display_phone, verified_name: bot.verified_name,
      webhook_url: `${SUPABASE_URL}/functions/v1/whatsapp`, verify_token: plat.wa_verify_token || null,
      app_secret_ok: !!(sec.wa_app_secret || plat.wa_app_secret),
    });
  }

  if (action === "connect") {
    const pnid = digits(body.phone_number_id), waba = digits(body.waba_id), token = String(body.token || "").trim();
    const appSecret = String(body.app_secret || "").trim();
    if (pnid.length < 5) return json({ error: "Cole o ID do número de telefone (Phone number ID) que aparece na Meta." }, 400);
    if (waba.length < 5) return json({ error: "Cole o ID da conta do WhatsApp Business (WABA ID)." }, 400);
    if (!/^EA[A-Za-z0-9]{40,}$/.test(token)) return json({ error: "Cole o token de acesso permanente da Meta (começa com EA)." }, 400);
    if (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret)) return json({ error: "A Chave Secreta do App tem 32 letras e números. Confira." }, 400);
    const ph = await graph(token, `/${pnid}?fields=display_phone_number,verified_name,quality_rating`);
    if (!ph.ok) return json({ error: `A Meta não aceitou: ${metaError(ph.data)}` }, 400);
    const { data: other } = await admin.from("whatsapp_bots").select("restaurant_id").eq("phone_number_id", pnid).neq("restaurant_id", R.id).maybeSingle();
    if (other) return json({ error: "Este número já está conectado em outra loja do BoraLanchar!." }, 409);
    const sub = await graph(token, `/${waba}/subscribed_apps`, { method: "POST" });
    if (!sub.ok) return json({ error: `Não consegui ligar os avisos de mensagens (WABA ID certo?): ${metaError(sub.data)}` }, 400);
    await admin.from("restaurant_secrets").upsert({ restaurant_id: R.id, wa_token: token, ...(appSecret ? { wa_app_secret: appSecret } : {}), updated_at: new Date().toISOString() }, { onConflict: "restaurant_id" });
    const up = await admin.from("whatsapp_bots").update({
      phone_number_id: pnid, waba_id: waba, display_phone: String(ph.data.display_phone_number || "").slice(0, 30), verified_name: String(ph.data.verified_name || "").slice(0, 120), enabled: true,
    }).eq("restaurant_id", R.id).select().single();
    if (up.error) return json({ error: "Não foi possível salvar a conexão." }, 500);
    return json({ ok: true, bot: up.data });
  }

  if (action === "disconnect") {
    await admin.from("restaurant_secrets").update({ wa_token: null, wa_app_secret: null, updated_at: new Date().toISOString() }).eq("restaurant_id", R.id);
    const up = await admin.from("whatsapp_bots").update({ phone_number_id: null, waba_id: null, display_phone: null, verified_name: null, enabled: false }).eq("restaurant_id", R.id).select().single();
    return json({ ok: true, bot: up.data });
  }

  if (!bot.phone_number_id || !sec.wa_token) return json({ error: "Conecte o número do WhatsApp primeiro." }, 400);

  if (action === "send") {
    const text = String(body.text || "").trim().slice(0, 4000);
    if (!text) return json({ error: "Escreva a mensagem." }, 400);
    const { data: conv } = await admin.from("wa_conversations").select("*").eq("id", Number(body.conversation_id) || 0).eq("restaurant_id", R.id).maybeSingle();
    if (!conv) return json({ error: "Conversa não encontrada." }, 404);
    if (!conv.last_inbound_at || Date.now() - new Date(conv.last_inbound_at).getTime() > 24 * 3600e3)
      return json({ error: "Já passou 24h da última mensagem do cliente. Pela regra do WhatsApp, só dá para responder quando ele mandar mensagem de novo (ou abra a conversa no seu celular)." }, 400);
    const r = await sendText(bot, sec.wa_token, conv, text, "loja");
    if (!r.ok) return json({ error: `O WhatsApp recusou: ${metaError(r.data)}` }, 400);
    const until = new Date(Date.now() + (bot.human_minutes || 120) * 60000).toISOString();
    await admin.from("wa_conversations").update({ human_until: until, unread: 0 }).eq("id", conv.id);
    return json({ ok: true });
  }

  if (action === "test") {
    // número de teste: o dono manda "oi" para o número conectado e o robô responde.
    // Aqui só confere se o token ainda vale.
    const ph = await graph(sec.wa_token, `/${bot.phone_number_id}?fields=display_phone_number,quality_rating`);
    if (!ph.ok) return json({ error: `O token parou de funcionar: ${metaError(ph.data)}` }, 400);
    return json({ ok: true, display_phone: ph.data.display_phone_number, quality: ph.data.quality_rating || null });
  }

  return json({ error: "Ação inválida" }, 400);
}

/* ---------------- entrada ---------------- */
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  try {
    // 1) verificação do webhook (Meta › WhatsApp › Configuração › Webhook)
    if (req.method === "GET") {
      if (url.searchParams.get("hub.mode") === "subscribe") {
        const plat = await platform();
        const tok = url.searchParams.get("hub.verify_token") || "";
        if (plat.wa_verify_token && safeEqual(tok, plat.wa_verify_token)) return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
        return new Response("forbidden", { status: 403 });
      }
      return new Response("BoraLanchar! WhatsApp", { status: 200 });
    }

    const action = url.searchParams.get("action") || "";

    // 2) aviso de status (vem do próprio banco)
    if (action === "notify") {
      const plat = await platform();
      if (!plat.wa_hook_secret || !safeEqual(req.headers.get("x-bora-hook") || "", plat.wa_hook_secret)) return json({ error: "forbidden" }, 403);
      const b = await req.json().catch(() => ({}));
      return json(await notify(Number(b.order_id) || 0, String(b.status || "")));
    }

    const raw = await req.text();
    const sig = req.headers.get("x-hub-signature-256") || "";

    // 3) mensagens da Meta: responde 200 na hora e trabalha em segundo plano
    if (sig) {
      const job = handleWebhook(raw, sig).catch((e) => console.error("whatsapp:", e));
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job); else await job;
      return new Response("ok", { status: 200 });
    }

    // 4) painel do dono
    let body: Row = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    return await ownerAction(req, String(body.action || action), body);
  } catch (e) {
    console.error("whatsapp:", e);
    return json({ error: "Erro no servidor" }, 500);
  }
});
