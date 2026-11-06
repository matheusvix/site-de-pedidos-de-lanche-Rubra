/* ============================================================
   BoraLanchar! — Black Friday 2026 (até 30/11, 23h59 de Brasília)
   30% OFF nas 3 primeiras mensalidades + 15 dias de teste grátis.
   Depois da data este arquivo não faz nada e o site volta ao normal.
   Banco: supabase/black-friday.sql (o desconto de verdade é calculado lá)
   ============================================================ */
(() => {
  const END = Date.parse('2026-12-01T03:00:00Z');
  const on = Date.now() < END;
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // price também vale depois de 30/11 para quem ainda tem mensalidades com desconto
  window.BORA_BF = { on, off: 0.3, months: 3, trial: on ? 15 : 7, brl, price: (n) => Math.round(n * 70) / 100 };
  const css = document.createElement('style');
  css.textContent = `
.bf-bar{background:#0E0A08;color:#F6E7B8;text-align:center;font:600 14px/1.35 var(--body,system-ui);padding:10px 16px;border-bottom:1px solid #3A2C14}
.bf-bar b{color:#F2C14E;font-weight:800;letter-spacing:.04em}
.bf-bar a{color:#0E0A08;background:linear-gradient(135deg,#F7D774,#C9962B);border-radius:999px;padding:4px 12px;margin-left:8px;font-weight:800;white-space:nowrap;display:inline-block}
.bf-old{color:var(--muted-2,#8a7b7c);font-size:18px;font-weight:600;text-decoration:line-through}
.plan.featured .bf-old{color:#BFAFB0}
.bf-tag{display:inline-flex;align-items:center;gap:6px;margin-top:6px;background:#0E0A08;color:#F2C14E;border:1px solid #6B5220;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;letter-spacing:.02em}
.plan.featured .bf-tag{border-color:#F2C14E}
.as-plan .bf-old{color:#D9C9CA;font-size:20px}
.as-plan .bf-tag{margin:2px 0 10px}
.bf-tag[hidden],.bf-old[hidden]{display:none}`;
  document.head.appendChild(css);
  if (!on) return;

  const run = () => {
    document.querySelectorAll('[data-trial-days]').forEach((e) => { e.textContent = '15'; });
    // faixa no topo do site
    if (document.querySelector('.header') && !document.querySelector('.bf-bar')) {
      const bar = document.createElement('div');
      bar.className = 'bf-bar';
      bar.innerHTML = '<b>BLACK FRIDAY</b> · 30% OFF nos 3 primeiros meses + 15 dias grátis, até 30/11 <a href="#planos">Aproveitar</a>';
      document.body.prepend(bar);
    }
    // preços dos planos na página inicial
    document.querySelectorAll('.plan .price b').forEach((b) => {
      if (b.dataset.bf) return;
      const v = Number(b.textContent.replace(/[^\d,]/g, '').replace(',', '.'));
      if (!v) return;
      b.dataset.bf = '1';
      const old = document.createElement('s'); old.className = 'bf-old'; old.textContent = brl(v);
      b.parentElement.prepend(old);
      b.textContent = brl(window.BORA_BF.price(v));
      const tag = document.createElement('span'); tag.className = 'bf-tag'; tag.textContent = 'Black Friday: 30% OFF nos 3 primeiros meses';
      b.parentElement.after(tag);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
