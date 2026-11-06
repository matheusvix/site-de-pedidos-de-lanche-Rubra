/* ============================================================
   BoraLanchar! — Black Friday 2026 (até 30/11, 23h59 de Brasília)
   30% OFF nas 3 primeiras mensalidades + 15 dias de teste grátis.
   Liga o visual vermelho/preto/amarelo (blackfriday.css) na página inicial.
   Depois da data este arquivo não muda nada e o site volta ao normal.
   Banco: supabase/black-friday.sql (o desconto de verdade é calculado lá)
   ============================================================ */
(() => {
  const END = Date.parse('2026-12-01T03:00:00Z');
  const on = Date.now() < END;
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // price também vale depois de 30/11 para quem ainda tem mensalidades com desconto
  window.BORA_BF = { on, off: 0.3, months: 3, trial: on ? 15 : 7, brl, price: (n) => Math.round(n * 70) / 100 };
  if (!on) return;
  const isHome = () => !!document.querySelector('.hero');

  const BADGE = (cls = '') => `<div class="bf-badge ${cls}" role="img" aria-label="Black Friday"><div class="bf-badge-in" aria-hidden="true"><span class="b1">BLACK</span><span class="b2">FRIDAY</span><span class="b3">%</span></div></div>`;
  const two = (n) => String(n).padStart(2, '0');
  function left() {
    const ms = Math.max(0, END - Date.now());
    return { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 };
  }
  function sparks(el, n) {
    if (!el || el.querySelector(':scope > .bf-sparks')) return;
    const box = document.createElement('div'); box.className = 'bf-sparks'; box.setAttribute('aria-hidden', 'true');
    let html = '';
    for (let i = 0; i < n; i++) {
      const c = i % 3 === 0 ? '#FFD21F' : '#FF2338';
      html += `<i style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;--c:${c};--r:${Math.round(Math.random() * 60 - 30)}deg;--t:${(2 + Math.random() * 3).toFixed(1)}s;--dl:-${(Math.random() * 4).toFixed(1)}s"></i>`;
    }
    box.innerHTML = html; el.prepend(box);
  }

  function heroBF() {
    const main = document.querySelector('main'); if (!main || document.querySelector('.bf-hero')) return;
    const sec = document.createElement('section');
    sec.className = 'bf-hero'; sec.setAttribute('aria-label', 'Black Friday BoraLanchar!');
    sec.innerHTML = `
      <span class="bf-chain c1" aria-hidden="true"></span><span class="bf-chain c2" aria-hidden="true"></span>
      <div class="container bf-hero-grid">
        <div class="bf-copy">
          ${BADGE()}
          <h2 class="bf-h1">Seu delivery com <em>30% OFF</em> por <strong>3 meses.</strong></h2>
          <p class="bf-sub">Cardápio digital, pedidos no painel e <b>zero comissão</b>. Assine até 30/11 com desconto nas 3 primeiras mensalidades ou teste <b>15 dias grátis</b>, sem cartão.</p>
          <div class="ctas">
            <a class="btn btn-yellow btn-lg" href="#planos">Garantir 30% OFF</a>
            <button class="btn btn-outline btn-lg" type="button" data-open="signup">Testar 15 dias grátis</button>
          </div>
          <ul class="bf-perks">
            <li><svg width="16" height="16"><use href="#i-check"/></svg>Sem taxa por pedido</li>
            <li><svg width="16" height="16"><use href="#i-check"/></svg>Sem fidelidade</li>
            <li><svg width="16" height="16"><use href="#i-check"/></svg>Cardápio no ar hoje</li>
          </ul>
        </div>
        <div class="bf-stage">
          <div class="bf-watch" role="timer" aria-label="Tempo até o fim da oferta">
            <div class="bf-face"><small>Faltam</small><b id="bf-days">00</b><span id="bf-unit">DIAS</span><em id="bf-hms">00:00:00</em></div>
          </div>
          <img class="bf-mascot" src="assets/bf/mascote-megafone.webp" alt="" aria-hidden="true" width="720" height="707" decoding="async">
        </div>
      </div>`;
    main.prepend(sec);
    const strip = document.createElement('div');
    strip.className = 'bf-strip';
    strip.innerHTML = `<div class="container">
      <span><i>30% OFF</i>nas 3 primeiras mensalidades</span>
      <span><i>15 DIAS</i>de teste grátis, sem cartão</span>
      <span><svg width="18" height="18"><use href="#i-bolt"/></svg>Vale até 30/11 às 23h59</span></div>`;
    sec.after(strip);
    sparks(sec, 34);
  }

  function tick() {
    const t = left();
    const days = document.getElementById('bf-days');
    if (days) {
      const lastDay = t.d === 0;
      days.textContent = two(lastDay ? t.h : t.d);
      document.getElementById('bf-unit').textContent = lastDay ? (t.h === 1 ? 'HORA' : 'HORAS') : (t.d === 1 ? 'DIA' : 'DIAS');
      document.getElementById('bf-hms').textContent = lastDay ? `${two(t.m)}:${two(t.s)}` : `${two(t.h)}:${two(t.m)}:${two(t.s)}`;
    }
    const clk = document.getElementById('bf-clock');
    if (clk) clk.textContent = t.d > 0 ? `${t.d}d ${two(t.h)}h ${two(t.m)}m` : `${two(t.h)}h ${two(t.m)}m ${two(t.s)}s`;
  }

  const run = () => {
    document.querySelectorAll('[data-trial-days]').forEach((e) => { e.textContent = '15'; });
    if (!isHome()) return;
    document.documentElement.classList.add('bf');
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = '#080505';

    // faixa no topo com o relógio
    if (!document.querySelector('.bf-bar')) {
      const bar = document.createElement('div');
      bar.className = 'bf-bar';
      bar.innerHTML = '<b>BLACK FRIDAY</b><span>30% OFF por 3 meses + 15 dias grátis · acaba em</span><span class="bf-clock" id="bf-clock">--</span><a href="#planos">Aproveitar</a>';
      document.body.prepend(bar);
    }
    const logo = document.querySelector('.header .wordmark'); if (logo) logo.src = 'assets/brand/campainha-logo-branco.svg';
    heroBF();

    // herói do produto: mascote no lugar do selo
    const st = document.querySelector('.hero-sticker');
    if (st) { st.src = 'assets/bf/mascote-campainha.webp'; st.width = 720; st.height = 669; }

    // planos: preço com desconto, selo e mascote com a etiqueta
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
    const planos = document.getElementById('planos');
    if (planos && !planos.querySelector('.bf-plans-mascot')) {
      planos.insertAdjacentHTML('afterbegin', `<img class="bf-mascot bf-plans-mascot" src="assets/bf/mascote-etiqueta.webp" alt="" aria-hidden="true" width="720" height="587" decoding="async"><div class="bf-plans-badge" aria-hidden="true">${BADGE('sm')}</div>`);
      sparks(planos, 22);
    }

    // chamada final: mascote com o presente (15 dias grátis)
    const seal = document.querySelector('.cta-seal');
    if (seal) { seal.loading = 'eager'; seal.src = 'assets/bf/mascote-presente.webp'; seal.width = 720; seal.height = 627; }
    const cta = document.querySelector('.cta-box');
    if (cta) {
      sparks(cta, 16);
      const k = cta.querySelector('.cta-kicker'); if (k) k.textContent = 'Black Friday BoraLanchar!';
    }

    tick(); setInterval(tick, 1000);
  };
  // o script fica no fim da página: o conteúdo já existe, então liga na hora (sem piscar o visual antigo)
  if (document.querySelector('.footer, .as-body, main')) run(); else document.addEventListener('DOMContentLoaded', run);
})();
