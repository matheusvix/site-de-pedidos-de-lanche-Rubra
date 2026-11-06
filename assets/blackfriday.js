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
.bf-tag[hidden],.bf-old[hidden]{display:none}
/* clima de Black Friday na página inicial (html.bf) */
html.bf{--gold:#F2C14E;--gold-2:#C9962B;--night:#0E0A08}
html.bf .header{background:rgba(14,10,8,.94);border-bottom-color:#3A2C14}
html.bf .nav-links a,html.bf .nav-actions .btn-ghost,html.bf .nav-actions a:not(.btn-primary){color:#F3E9DA}
html.bf .nav-links a:hover{color:var(--gold)}
html.bf .hero{background:var(--night);color:#fff}
html.bf .hero::before{background:repeating-conic-gradient(rgba(242,193,78,.10) 0 7.5deg,transparent 7.5deg 15deg)}
html.bf .hero h1 em{background:linear-gradient(120deg,#FFE8A3,#F2C14E 45%,#C9962B);-webkit-background-clip:text;background-clip:text;color:transparent}
html.bf .hero-sub,html.bf .hero .checks{color:#D9CFC0}
html.bf .hero .checks svg{color:var(--gold)!important}
html.bf .hero .pill{background:#1A140C;border-color:var(--gold);color:var(--gold);box-shadow:3px 3px 0 var(--gold-2)}
html.bf .hero .pill i{background:var(--gold)}
html.bf .hero .btn-outline{border-color:#fff;color:#fff}
html.bf .hero .btn-outline:hover{background:#fff;color:var(--night)}
html.bf .hero-quote{background:#1A140C;border-color:#3A2C14}
html.bf .hero-quote p{color:#F3E9DA}
html.bf .band-red{background:var(--night);border-top:2px solid var(--gold-2);border-bottom:2px solid var(--gold-2)}
html.bf .band-red::before{background:repeating-conic-gradient(rgba(242,193,78,.07) 0 8deg,transparent 8deg 16deg)}
html.bf .band-red .stat b{color:var(--gold)}
html.bf #planos{background:radial-gradient(70% 50% at 50% 0,rgba(242,193,78,.16),transparent 70%),var(--night)}
html.bf #planos .head{color:#fff}
html.bf #planos .eyebrow{color:var(--gold)}
html.bf #planos .lead,html.bf #planos .fine{color:#D9CFC0}
html.bf #planos .fine a{color:var(--gold)}
html.bf .plan{border-color:#3A2C14}
html.bf .plan.featured{border-color:var(--gold)!important;box-shadow:6px 6px 0 var(--gold-2)!important}
html.bf .plan:is(:hover,.is-on){border-color:var(--gold)!important;box-shadow:6px 6px 0 var(--gold-2)!important}
html.bf .plans:is(.has-on,:has(.plan:hover)) .plan.featured:not(.is-on,:hover){box-shadow:none!important;border-color:#3A2C14!important}
html.bf .plan .badge{background:linear-gradient(135deg,#F7D774,#C9962B);color:var(--night);border-color:var(--night)}
html.bf .cta-box{background:radial-gradient(60% 80% at 100% 100%,rgba(242,193,78,.22),transparent 70%),var(--night);border:2px solid var(--gold-2)}
html.bf .cta-box::after{border-color:rgba(242,193,78,.10)}
html.bf .cta-kicker{color:var(--gold)}
html.bf .cta-box p{color:#D9CFC0}`;
  document.head.appendChild(css);
  if (!on) return;

  const run = () => {
    document.querySelectorAll('[data-trial-days]').forEach((e) => { e.textContent = '15'; });
    // página inicial no clima de Black Friday (preto e dourado)
    if (document.querySelector('.hero')) {
      document.documentElement.classList.add('bf');
      const logo = document.querySelector('.header .wordmark'); if (logo) logo.src = 'assets/brand/campainha-logo-branco.svg';
      const pill = document.querySelector('.hero .pill');
      if (pill) pill.innerHTML = '<i aria-hidden="true"></i>Black Friday: 30% OFF por 3 meses + 15 dias grátis';
    }
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
