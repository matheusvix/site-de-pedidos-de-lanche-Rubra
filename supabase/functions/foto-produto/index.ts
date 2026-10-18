// BoraLanchar! — Foto profissional do produto gerada por IA (OpenAI; Google Gemini como reserva)
// POST { name, description?, restaurant_id? }  (Authorization: Bearer <jwt do dono ou do admin>)
// -> { image: "data:image/png;base64,...", remaining }
// Segredo: OPENAI_API_KEY (preferido) ou GEMINI_API_KEY (Supabase › Edge Functions › Secrets)
// Opcionais: OPENAI_IMAGE_MODEL (padrão gpt-image-1.5), OPENAI_IMAGE_QUALITY (low|medium|high, padrão medium)
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") || "gemini-2.5-flash-image";
const OAI_MODEL = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-1.5";
const OAI_QUALITY = Deno.env.get("OPENAI_IMAGE_QUALITY") || "medium";

type Gen = { image?: string; error?: string; blocked?: boolean };

async function genOpenAI(key: string, text: string): Promise<Gen> {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: OAI_MODEL, prompt: text, n: 1, size: "1024x1024", quality: OAI_QUALITY, output_format: "jpeg", output_compression: 85 }),
  });
  const data = await r.json().catch(() => ({}));
  const b64 = data?.data?.[0]?.b64_json;
  if (!r.ok || !b64) {
    console.error("openai", r.status, JSON.stringify(data).slice(0, 600));
    return { error: String(data?.error?.code || data?.error?.type || r.status), blocked: data?.error?.code === "moderation_blocked" || data?.error?.code === "content_policy_violation" };
  }
  return { image: `data:image/jpeg;base64,${b64}` };
}

async function genGemini(key: string, text: string): Promise<Gen> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    }),
  });
  const data = await r.json().catch(() => ({}));
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
  const inline = img?.inlineData || img?.inline_data;
  if (!r.ok || !inline) {
    console.error("gemini", r.status, JSON.stringify(data).slice(0, 600));
    return { error: String(r.status), blocked: !!(data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason === "SAFETY") };
  }
  return { image: `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}` };
}
const MONTHLY_LIMIT = Number(Deno.env.get("FOTO_IA_LIMITE_MES") || 60);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const clean = (s: unknown, max: number) =>
  String(s ?? "").replace(/[\u0000-\u001f"<>{}\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function prompt(name: string, desc: string) {
  return [
    `Professional food photograph for the online menu of a Brazilian snack bar (lanchonete). The item is called "${name}".`,
    desc ? `Details from the menu: ${desc}.` : "",
    "Interpret the name the way it is understood in Brazil: an \"X-\" item is a sandwich with cheese on a round bun (X-Burger = cheeseburger, X-Salada adds lettuce and tomato, X-Bacon adds bacon, X-Egg adds fried egg, X-Tudo has everything); if the name mentions an ingredient (for example banana, calabresa, frango, catupiry, cheddar), make it clearly visible.",
    "Show only this one item as it would be served to the customer (sandwich, portion, drink, dessert or combo as appropriate), realistic and appetizing, centered with some margin, three-quarter angle, soft natural studio light, shallow depth of field, simple clean background (dark wood or neutral surface).",
    "Absolutely no text, letters, numbers, logos, brand names, packaging labels, watermarks, hands or people.",
  ].filter(Boolean).join(" ");
}

async function isAdminEmail(email: string) {
  if (!email) return false;
  const { data } = await admin.from("admins").select("email").ilike("email", email).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método inválido" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (!u?.user) return json({ error: "Entre na sua conta para gerar fotos." }, 401);

    const body = await req.json().catch(() => ({}));
    const name = clean(body.name, 80);
    const desc = clean(body.description, 300);
    if (name.length < 2) return json({ error: "Digite o nome do produto primeiro." }, 400);

    const isAdm = await isAdminEmail(u.user.email || "");
    let rid = "";
    if (body.restaurant_id && isAdm) rid = String(body.restaurant_id);
    else {
      const { data: r } = await admin.from("restaurants").select("id").eq("owner_id", u.user.id).order("created_at").limit(1).maybeSingle();
      rid = r?.id || "";
    }
    if (!/^[0-9a-f-]{36}$/i.test(rid)) return json({ error: "Loja não encontrada." }, 404);

    const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
    const { count } = await admin.from("ai_image_log").select("id", { count: "exact", head: true })
      .eq("restaurant_id", rid).eq("ok", true).gte("created_at", since.toISOString());
    const used = count || 0;
    if (!isAdm && used >= MONTHLY_LIMIT)
      return json({ error: `Você já gerou ${MONTHLY_LIMIT} fotos este mês. O limite renova no dia 1º. Enquanto isso, dá para enviar uma foto sua.`, remaining: 0 }, 429);

    const oaiKey = Deno.env.get("OPENAI_API_KEY"), gemKey = Deno.env.get("GEMINI_API_KEY");
    if (!oaiKey && !gemKey) return json({ error: "A geração de fotos ainda não foi ativada. Fale com o suporte do BoraLanchar!." }, 503);

    const text = prompt(name, desc);
    let g: Gen = oaiKey ? await genOpenAI(oaiKey, text) : { error: "sem openai" };
    if (!g.image && !g.blocked && gemKey) g = await genGemini(gemKey, text);
    if (!g.image) {
      await admin.from("ai_image_log").insert({ restaurant_id: rid, product_name: name, ok: false });
      return json({ error: g.blocked ? "Não consegui gerar uma foto para esse nome. Tente escrever de outro jeito." : "Não consegui gerar a foto agora. Tente de novo em instantes." }, 502);
    }
    await admin.from("ai_image_log").insert({ restaurant_id: rid, product_name: name, ok: true });
    return json({ image: g.image, remaining: isAdm ? null : Math.max(0, MONTHLY_LIMIT - used - 1) });
  } catch (e) {
    console.error(e);
    return json({ error: "Não consegui gerar a foto agora. Tente de novo em instantes." }, 500);
  }
});
