/* ============================================================
   BoraLanchar! — "Corrida da Entrega": joguinho para o cliente
   passar o tempo enquanto espera o pedido.
   O motoboy leva o lanche desviando dos carros. Pega 🍔 (pontos)
   e ⛽ (combustível). Bateu, perde combustível. Acabou o tanque,
   acabou a corrida.
   Uso: BoraJogo.open({ store: 'Nome da loja' }) · BoraJogo.notify('texto')
   ============================================================ */
window.BoraJogo = (() => {
  const RED = '#E01E2D', INK = '#1A1112', CREAM = '#FFF6F1';
  const CAR_COLORS = ['#2D6CDF', '#F2B705', '#1E8A4C', '#7A3EC8', '#FF7A1A', '#3A3A3A', '#0FA3B1', '#C2185B'];
  let root, cv, ctx, raf = 0, last = 0, S = null, store = '', dpr = 1, W = 0, H = 0, msgT = 0, msg = '', OPTS = {};
  const rnd = (a, b) => a + Math.random() * (b - a);
  const best = () => { try { return +localStorage.getItem('bora-jogo-best') || 0; } catch (_) { return 0; } };
  const saveBest = (v) => { try { localStorage.setItem('bora-jogo-best', String(v)); } catch (_) {} };

  /* ---------- tela ---------- */
  function build() {
    root = document.createElement('div');
    root.className = 'bj-root';
    root.innerHTML = `<style>
      .bj-root{position:fixed;inset:0;z-index:9999;background:#2E7D32;display:flex;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none}
      .bj-root canvas{display:block;height:100%;max-width:520px;width:100%;touch-action:none}
      .bj-x{position:absolute;top:max(10px,env(safe-area-inset-top));right:10px;width:44px;height:44px;border-radius:50%;border:0;background:rgba(26,17,18,.75);color:#fff;font-size:22px;line-height:1;cursor:pointer;z-index:2}
      .bj-x:focus-visible{outline:3px solid #fff}
      .bj-over{position:absolute;inset:0;touch-action:pan-y;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(26,17,18,.6);z-index:1;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
      .bj-over[hidden]{display:none}
      .bj-card{width:100%;max-width:380px;max-height:100%;overflow:auto;background:#FFF6F1;border-radius:24px;padding:22px 20px;color:#1A1112;text-align:center;box-shadow:0 20px 50px -20px rgba(0,0,0,.6)}
      .bj-card h2{margin:0;color:#E01E2D;font-size:26px;font-style:italic;font-weight:900}
      .bj-pts{font-size:34px;font-weight:900;margin:6px 0 0;letter-spacing:-.02em}
      .bj-sub{margin:2px 0 0;color:#6B5A5B;font-size:14px}
      .bj-prize{margin:14px 0 0;border:2px dashed #E01E2D;background:#fff;border-radius:16px;padding:12px}
      .bj-prize b{display:block;font-size:15px}
      .bj-code{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:8px}
      .bj-code code{font-size:22px;font-weight:900;letter-spacing:.08em;background:#FFE3E5;border-radius:10px;padding:6px 12px;color:#A3101B}
      .bj-code button,.bj-btns button{border:0;border-radius:999px;font-weight:800;font-size:15px;cursor:pointer;min-height:44px;padding:10px 16px}
      .bj-code button{background:#1A1112;color:#fff}
      .bj-goal{margin:12px 0 0;background:#fff;border-radius:14px;padding:10px 12px;font-size:14px}
      .bj-rank{list-style:none;margin:14px 0 0;padding:0;text-align:left;display:flex;flex-direction:column;gap:5px}
      .bj-rank li{display:flex;gap:8px;align-items:center;background:#fff;border-radius:12px;padding:7px 10px;font-size:14px}
      .bj-rank li.me{outline:2px solid #E01E2D}
      .bj-rank li span:first-child{width:24px;text-align:center;font-weight:800;color:#6B5A5B}
      .bj-rank li b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bj-rank h3{margin:0 0 2px;font-size:15px}
      .bj-btns{display:flex;flex-direction:column;gap:8px;margin-top:16px}
      .bj-btns .bj-again{background:#E01E2D;color:#fff}
      .bj-btns .bj-back{background:transparent;color:#1A1112}
    </style><canvas aria-label="Jogo Corrida da Entrega"></canvas><div class="bj-over" hidden></div><button class="bj-x" type="button" aria-label="Fechar o jogo">✕</button>`;
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
    root.querySelector('.bj-x').addEventListener('click', close);
    root.querySelector('.bj-over').addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    // controle: arrastar o dedo (ou o mouse) para os lados; tocar para começar
    const pos = (e) => { const r = cv.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return (p.clientX - r.left) / r.width * W; };
    const down = (e) => {
      if (e.target !== cv) return;
      e.preventDefault();
      if (!S || S.mode !== 'play') { if (!S || S.mode === 'intro' || (S.mode === 'over' && performance.now() - S.overAt > 700)) start(); return; }
      S.drag = true; S.tx = pos(e);
    };
    const move = (e) => { if (S && S.drag) { e.preventDefault(); S.tx = pos(e); } };
    const up = () => { if (S) S.drag = false; };
    cv.addEventListener('touchstart', down, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', up);
    cv.addEventListener('mousedown', down); addEventListener('mousemove', move); addEventListener('mouseup', up);
    addEventListener('keydown', key); addEventListener('keyup', key);
    addEventListener('resize', size);
    document.addEventListener('visibilitychange', vis);
    size();
  }
  function size() {
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S) layout();
  }
  const KEYS = {};
  function key(e) {
    if (!root) return;
    if (e.key === 'Escape' && e.type === 'keydown') { close(); return; }
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) { KEYS[e.key.toLowerCase()] = e.type === 'keydown'; e.preventDefault(); }
    if ((e.key === ' ' || e.key === 'Enter') && e.type === 'keydown' && S && S.mode !== 'play') { e.preventDefault(); start(); }
  }
  function vis() { if (document.hidden && S && S.mode === 'play') S.mode = 'pause'; }

  /* ---------- partida ---------- */
  function layout() {
    S.roadW = Math.min(W * 0.78, 400); S.roadX = (W - S.roadW) / 2; S.lanes = 4; S.laneW = S.roadW / S.lanes;
    S.pw = Math.max(30, S.laneW * 0.5); S.ph = S.pw * 1.9; S.py = H - S.ph - Math.max(40, H * 0.08);
  }
  function fresh(mode) {
    S = { mode, t: 0, dist: 0, bonus: 0, speed: 230, fuel: 100, px: 0, tx: null, drag: false, things: [], deco: [], spawn: 0.6, item: 2.5, stun: 0, inv: 0, overAt: 0, slide: 0, line: 0, puffs: [] };
    layout(); S.px = W / 2;
    for (let y = -40; y < H + 80; y += rnd(50, 110)) S.deco.push(decoAt(y));
  }
  function start() { fresh('play'); last = performance.now(); }
  function decoAt(y) {
    const left = Math.random() < 0.5, x = left ? rnd(6, S.roadX - 18) : rnd(S.roadX + S.roadW + 18, W - 6);
    return { x, y, k: Math.random() < 0.75 ? 'tree' : 'bush', r: rnd(10, 18) };
  }
  function laneX(i) { return S.roadX + S.laneW * (i + 0.5); }
  function spawnCar() {
    const lane = Math.floor(Math.random() * S.lanes);
    const truck = Math.random() < 0.18;
    const w = S.laneW * (truck ? 0.66 : 0.56), h = w * (truck ? 2.6 : 1.75);
    const shifty = S.dist > 4000 && Math.random() < 0.25; // a partir de um ponto, alguns carros trocam de faixa
    // não deixa todas as faixas bloqueadas ao mesmo tempo
    const blocked = S.things.filter((t) => t.k === 'car' && t.y < 40 && t.y > -h * 2).map((t) => t.lane);
    if (new Set([...blocked, lane]).size >= S.lanes) return;
    S.things.push({ k: 'car', lane, x: laneX(lane), y: -h - 10, w, h, c: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], v: rnd(0.35, 0.65), dx: shifty ? (Math.random() < 0.5 ? -1 : 1) : 0, truck });
  }
  function spawnItem() {
    const lane = Math.floor(Math.random() * S.lanes);
    const kind = S.fuel < 55 && Math.random() < 0.6 ? 'fuel' : Math.random() < 0.18 ? 'oil' : 'burger';
    const s = S.laneW * 0.5;
    S.things.push({ k: kind, lane, x: laneX(lane), y: -s - 10, w: s, h: s });
  }
  const hit = (a, b, m = 0.78) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 * m && Math.abs(a.y - b.y) < (a.h + b.h) / 2 * m;

  function update(dt) {
    S.t += dt;
    // velocidade sobe com o tempo; batida derruba
    const target = Math.min(720, 260 + S.t * 9);
    S.speed += (target * (S.stun > 0 ? 0.45 : 1) - S.speed) * Math.min(1, dt * 1.6);
    const dy = S.speed * dt;
    S.dist += dy; S.line = (S.line + dy) % 60;
    S.fuel -= dt * (3.2 + S.t * 0.02);
    S.stun = Math.max(0, S.stun - dt); S.inv = Math.max(0, S.inv - dt); S.slide = Math.max(0, S.slide - dt);

    // motoboy
    const minX = S.roadX + S.pw / 2 + 2, maxX = S.roadX + S.roadW - S.pw / 2 - 2;
    let dir = (KEYS.arrowleft || KEYS.a ? -1 : 0) + (KEYS.arrowright || KEYS.d ? 1 : 0);
    if (dir) S.tx = null;
    if (S.tx != null) S.px += (S.tx - S.px) * Math.min(1, dt * 12);
    else S.px += dir * dt * S.roadW * 1.6;
    if (S.slide > 0) S.px += Math.sin(S.t * 18) * dt * 120;
    S.px = Math.max(minX, Math.min(maxX, S.px));

    // enfeites da beira da estrada
    for (const d of S.deco) d.y += dy;
    S.deco = S.deco.filter((d) => d.y < H + 40);
    while (!S.deco.length || Math.min(...S.deco.map((d) => d.y)) > -20) S.deco.push(decoAt(Math.min(0, ...S.deco.map((d) => d.y)) - rnd(40, 100)));

    // carros e itens
    S.spawn -= dt; S.item -= dt;
    if (S.spawn <= 0) { spawnCar(); S.spawn = Math.max(0.32, 1.05 - S.t * 0.012) * rnd(0.7, 1.3); }
    if (S.item <= 0) { spawnItem(); S.item = rnd(1.4, 2.6); }
    const me = { x: S.px, y: S.py + S.ph / 2, w: S.pw, h: S.ph };
    for (const o of S.things) {
      o.y += o.k === 'car' ? dy * (1 - o.v) : dy;
      if (o.k === 'car' && o.dx && o.y > H * 0.08) {
        o.x += o.dx * dt * S.laneW * 0.8;
        if (o.x < S.roadX + o.w / 2 || o.x > S.roadX + S.roadW - o.w / 2) o.dx *= -1;
      }
      if (o.gone) continue;
      if (!hit(me, o, o.k === 'car' ? 0.74 : 0.95)) continue;
      if (o.k === 'car') {
        if (S.inv > 0) continue;
        S.fuel -= 18; S.stun = 0.9; S.inv = 1.6; S.speed *= 0.4;
        puff(S.px, S.py, '#fff'); try { navigator.vibrate && navigator.vibrate(120); } catch (_) {}
      } else if (o.k === 'burger') { o.gone = true; S.bonus += 100; puff(o.x, o.y, '#FFC93C', '+100'); }
      else if (o.k === 'fuel') { o.gone = true; S.fuel = Math.min(100, S.fuel + 35); puff(o.x, o.y, '#7CD992', '+⛽'); }
      else if (o.k === 'oil') { o.gone = true; if (S.inv <= 0) S.slide = 1.1; }
    }
    S.things = S.things.filter((o) => !o.gone && o.y < H + o.h);
    for (const p of S.puffs) { p.t -= dt; p.y -= dt * 60; }
    S.puffs = S.puffs.filter((p) => p.t > 0);

    if (S.fuel <= 0) {
      S.fuel = 0; S.mode = 'over'; S.overAt = performance.now();
      const sc = score(); S.record = sc > best(); if (S.record) saveBest(sc);
      over(sc, S.record);
    }
  }
  const score = () => Math.floor(S.dist / 12) + S.bonus;
  const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
  const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- fim da partida: placar, ranking do dia e prêmio ---------- */
  async function over(sc, record) {
    const box = root.querySelector('.bj-over');
    const card = (inner) => { box.innerHTML = `<div class="bj-card" role="dialog" aria-label="Fim da corrida">${inner}<div class="bj-btns"><button type="button" class="bj-again">Jogar de novo</button><button type="button" class="bj-back">Voltar ao pedido</button></div></div>`;
      box.querySelector('.bj-again').onclick = () => { box.hidden = true; start(); };
      box.querySelector('.bj-back').onclick = close; };
    const head = `<h2>${record ? 'Novo recorde! 🏆' : 'Acabou o tanque!'}</h2><p class="bj-pts">${fmt(sc)} pontos</p><p class="bj-sub">Seu recorde: ${fmt(best())}</p>`;
    card(head + (OPTS.onEnd ? '<p class="bj-sub" style="margin-top:12px">Salvando no ranking…</p>' : ''));
    box.hidden = false;
    if (!OPTS.onEnd) return;
    let r = null; try { r = await OPTS.onEnd(sc); } catch (_) {}
    if (!root || !S || S.mode !== 'over') return;
    if (!r) { card(head + '<p class="bj-sub" style="margin-top:12px">Não deu para salvar no ranking agora.</p>'); return; }
    if (r.top) OPTS.top = r.top;
    if (r.rule) OPTS.rule = r.rule;
    let mid = '';
    if (r.reward) {
      const until = r.reward.expires_at ? new Date(r.reward.expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
      mid += `<div class="bj-prize"><b>🎁 Você ganhou ${escH(r.rule ? r.rule.label : 'um cupom')}!</b><span class="bj-sub">Use no próximo pedido${until ? ` até ${until}` : ''}${r.reward.used ? ' (já usado)' : ''}.</span>
        <div class="bj-code"><code>${escH(r.reward.code)}</code><button type="button" class="bj-copy">Copiar</button></div></div>`;
    } else if (r.rule) {
      const falta = Math.max(0, r.rule.score - (r.best || 0));
      mid += `<p class="bj-goal">🎁 Faça <b>${fmt(r.rule.score)}</b> pontos e ganhe <b>${escH(r.rule.label)}</b> no próximo pedido.${falta ? ` Faltam ${fmt(falta)}!` : ''}</p>`;
    }
    const top = (r.top || []).slice(0, 5);
    if (top.length) {
      let meDone = false;
      mid += `<ol class="bj-rank"><h3>Ranking de hoje${store ? ` · ${escH(store)}` : ''}</h3>${top.map((t, i) => {
        const me = !meDone && t.score === r.best && i + 1 === r.rank; if (me) meDone = true;
        return `<li class="${me ? 'me' : ''}"><span>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><b>${escH(t.name)}${me ? ' (você)' : ''}</b><strong>${fmt(t.score)}</strong></li>`;
      }).join('')}</ol>${r.rank > 5 ? `<p class="bj-sub">Você está em ${r.rank}º hoje com ${fmt(r.best)} pontos.</p>` : ''}`;
    }
    card(head + mid);
    const cp = box.querySelector('.bj-copy');
    if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(r.reward.code); cp.textContent = 'Copiado!'; } catch (_) { cp.textContent = r.reward.code; } };
  }
  function puff(x, y, c, txt) { S.puffs.push({ x, y, c, txt, t: 0.8 }); }

  /* ---------- desenho ---------- */
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
  function draw() {
    // grama e estrada
    ctx.fillStyle = '#3FA34D'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#378F43';
    for (let y = -60 + (S.line % 60); y < H; y += 60) ctx.fillRect(0, y, W, 30);
    ctx.fillStyle = '#C9C2B8'; ctx.fillRect(S.roadX - 8, 0, 8, H); ctx.fillRect(S.roadX + S.roadW, 0, 8, H);
    ctx.fillStyle = '#3B3536'; ctx.fillRect(S.roadX, 0, S.roadW, H);
    // zebra da borda
    for (let y = -60 + S.line; y < H; y += 60) { ctx.fillStyle = RED; ctx.fillRect(S.roadX - 8, y, 8, 30); ctx.fillRect(S.roadX + S.roadW, y, 8, 30); }
    // faixas
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 1; i < S.lanes; i++) for (let y = -60 + S.line; y < H; y += 60) ctx.fillRect(S.roadX + S.laneW * i - 2, y, 4, 32);
    // árvores
    for (const d of S.deco) {
      if (d.k === 'tree') { ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.arc(d.x + 4, d.y + 4, d.r, 0, 7); ctx.fill(); ctx.fillStyle = '#1F6E2C'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill(); ctx.fillStyle = '#2E8B3A'; ctx.beginPath(); ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.55, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = '#5FBF5A'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 0.6, 0, 7); ctx.arc(d.x + d.r * 0.5, d.y + 2, d.r * 0.45, 0, 7); ctx.fill(); }
    }
    // itens e carros
    for (const o of S.things) {
      if (o.k === 'car') car(o);
      else if (o.k === 'oil') { ctx.fillStyle = 'rgba(10,10,10,.85)'; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.w * 0.55, o.h * 0.35, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(120,120,255,.35)'; ctx.beginPath(); ctx.ellipse(o.x - 4, o.y - 3, o.w * 0.2, o.h * 0.1, 0, 0, 7); ctx.fill(); }
      else { ctx.font = `${Math.round(o.w)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.k === 'fuel' ? '⛽' : '🍔', o.x, o.y); }
    }
    moto();
    for (const p of S.puffs) { ctx.globalAlpha = Math.max(0, p.t / 0.8); ctx.fillStyle = p.c; ctx.font = '800 18px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.txt || '💥', p.x, p.y); ctx.globalAlpha = 1; }
    hud();
  }
  function car(o) {
    const x = o.x - o.w / 2, y = o.y - o.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(x + 3, y + 4, o.w, o.h, 8); ctx.fill();
    ctx.fillStyle = o.c; rr(x, y, o.w, o.h, 8); ctx.fill();
    ctx.fillStyle = 'rgba(20,30,45,.85)';
    if (o.truck) { rr(x + 4, y + o.h - o.w * 0.75, o.w - 8, o.w * 0.45, 4); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x + 4, y + 6, o.w - 8, o.h - o.w * 1.05); }
    else { rr(x + 4, y + o.h * 0.6, o.w - 8, o.h * 0.2, 4); ctx.fill(); rr(x + 5, y + o.h * 0.14, o.w - 10, o.h * 0.16, 4); ctx.fill(); }
    // lanternas (o carro vai no mesmo sentido: vemos a traseira em cima? não — vemos a frente embaixo)
    ctx.fillStyle = '#FFF3B0'; ctx.fillRect(x + 3, y + o.h - 5, 6, 4); ctx.fillRect(x + o.w - 9, y + o.h - 5, 6, 4);
    ctx.fillStyle = '#FF4D4D'; ctx.fillRect(x + 3, y + 1, 6, 3); ctx.fillRect(x + o.w - 9, y + 1, 6, 3);
  }
  function moto() {
    if (S.inv > 0 && Math.floor(S.t * 12) % 2) return; // pisca depois de bater
    const w = S.pw, h = S.ph, x = S.px, y = S.py;
    ctx.save(); ctx.translate(x, y + h / 2);
    if (S.stun > 0) ctx.rotate(Math.sin(S.t * 30) * 0.35); else if (S.slide > 0) ctx.rotate(Math.sin(S.t * 18) * 0.25);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(-w * 0.3 + 3, -h / 2 + 4, w * 0.6, h, 6); ctx.fill();
    // rodas
    ctx.fillStyle = '#111'; rr(-w * 0.12, -h / 2, w * 0.24, h * 0.24, 4); ctx.fill(); rr(-w * 0.12, h / 2 - h * 0.24, w * 0.24, h * 0.24, 4); ctx.fill();
    // corpo
    ctx.fillStyle = '#2B2B2B'; rr(-w * 0.18, -h * 0.32, w * 0.36, h * 0.66, 6); ctx.fill();
    // guidão
    ctx.fillStyle = '#555'; ctx.fillRect(-w * 0.42, -h * 0.28, w * 0.84, 4);
    // baú do delivery
    ctx.fillStyle = RED; rr(-w / 2, h * 0.02, w, h * 0.36, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(w * 0.32)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BORA', 0, h * 0.2);
    // capacete
    ctx.fillStyle = '#FFC93C'; ctx.beginPath(); ctx.arc(0, -h * 0.1, w * 0.26, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(26,17,18,.8)'; ctx.beginPath(); ctx.arc(0, -h * 0.15, w * 0.16, Math.PI, 0); ctx.fill();
    ctx.restore();
  }
  function hud() {
    const top = 12;
    ctx.fillStyle = 'rgba(26,17,18,.78)'; rr(10, top, 148, 50, 14); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 11px system-ui, sans-serif'; ctx.fillText('PONTOS', 22, top + 18);
    ctx.font = '800 22px system-ui, sans-serif'; ctx.fillText(score().toLocaleString('pt-BR'), 22, top + 42);
    // combustível
    const fw = Math.min(140, W - 262), fx = 166;
    if (fw > 60) {
      ctx.fillStyle = 'rgba(26,17,18,.78)'; rr(fx, top, fw + 24, 50, 14); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui, sans-serif'; ctx.fillText('⛽ TANQUE', fx + 12, top + 18);
      ctx.fillStyle = 'rgba(255,255,255,.2)'; rr(fx + 12, top + 28, fw, 12, 6); ctx.fill();
      ctx.fillStyle = S.fuel > 30 ? '#7CD992' : S.fuel > 15 ? '#FFC93C' : '#FF5A5A'; rr(fx + 12, top + 28, Math.max(0, fw * S.fuel / 100), 12, 6); ctx.fill();
    }
    if (msgT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,.96)'; rr(14, top + 62, W - 28, 46, 14); ctx.fill();
      ctx.fillStyle = INK; ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(msg, W / 2, top + 91, W - 50);
    }
  }
  function panel(title, lines, cta) {
    ctx.fillStyle = 'rgba(26,17,18,.55)'; ctx.fillRect(0, 0, W, H);
    const pw = Math.min(W - 32, 360), ph = 112 + lines.length * 26 + 70, x = (W - pw) / 2, y = (H - ph) / 2;
    ctx.fillStyle = CREAM; rr(x, y, pw, ph, 22); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = RED; ctx.font = '900 italic 26px system-ui, sans-serif'; ctx.fillText(title, W / 2, y + 50);
    ctx.fillStyle = INK;
    lines.forEach((l, i) => { ctx.font = l.b ? '800 20px system-ui, sans-serif' : '500 15px system-ui, sans-serif'; ctx.fillText(l.t, W / 2, y + 92 + i * 26, pw - 30); });
    ctx.fillStyle = RED; rr(x + 24, y + ph - 70, pw - 48, 50, 25); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '800 17px system-ui, sans-serif'; ctx.fillText(cta, W / 2, y + ph - 39);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    msgT = Math.max(0, msgT - dt);
    if (S.mode === 'play') update(dt);
    draw();
    if (S.mode === 'intro') {
      const L = [{ t: store ? `Leve o lanche da ${store}!` : 'Leve o lanche até o cliente!' }, { t: 'Arraste o dedo para desviar dos carros.' }, { t: '🍔 dá pontos  ·  ⛽ enche o tanque' }];
      if (OPTS.rule) L.push({ t: `🎁 ${fmt(OPTS.rule.score)} pontos = ${OPTS.rule.label}` });
      if (OPTS.top && OPTS.top[0]) L.push({ t: `🏆 Líder hoje: ${OPTS.top[0].name} · ${fmt(OPTS.top[0].score)}` });
      L.push({ t: `Seu recorde: ${fmt(best())}`, b: true });
      panel('Corrida da Entrega', L, 'Toque para começar');
    }
    else if (S.mode === 'pause') panel('Pausado', [{ t: 'Toque para continuar a corrida.' }], 'Continuar');
    else if (S.mode === 'over') { ctx.fillStyle = 'rgba(26,17,18,.35)'; ctx.fillRect(0, 0, W, H); }
  }

  /* ---------- API ---------- */
  function open(opts = {}) {
    store = opts.store || ''; OPTS = opts;
    if (root) return;
    build();
    fresh('intro');
    const resume = () => { if (S && S.mode === 'pause') { S.mode = 'play'; last = performance.now(); } };
    cv.addEventListener('pointerdown', resume);
    last = performance.now(); raf = requestAnimationFrame(frame);
    document.documentElement.style.overflow = 'hidden';
  }
  function close() {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', key); removeEventListener('keyup', key); removeEventListener('resize', size);
    document.removeEventListener('visibilitychange', vis);
    if (root) root.remove();
    root = cv = ctx = null; S = null;
    document.documentElement.style.overflow = '';
  }
  function notify(text) { if (!root) return; msg = text; msgT = 5; try { navigator.vibrate && navigator.vibrate([80, 60, 80]); } catch (_) {} }
  return { open, close, notify, isOpen: () => !!root };
})();
