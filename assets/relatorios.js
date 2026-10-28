/* ============================================================
   BoraLanchar! — aba Relatórios (todos os planos)
   Usa o que o painel.js já carregou: sb, R, brl, esc, digits, toast, $, $$.
   Banco: reports_data (supabase/etapa2-cardapio-relatorios.sql)
   ============================================================ */
window.BoraRelatorios = (() => {
  let days = 30, tab = 'clientes', D = null, busy = false, cq = '', cf = 'todos';
  const PAY = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro', mesa: 'Conta da mesa' };
  const fmtPhone = (d) => { d = String(d || ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };
  const dt = (t) => (t ? new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
  const ago = (t) => Math.floor((Date.now() - new Date(t)) / 86400000);
  const wa = (ph, name) => `https://wa.me/55${ph}?text=${encodeURIComponent(`Olá, ${(name || '').split(' ')[0]}! Aqui é da ${R.name}. 😊`)}`;
  const split = (arr, L, money = true) => { const tot = arr.reduce((s, x) => s + Number(x.v), 0) || 1; return arr.map((x) => `<div class="fs"><span>${esc(L ? L[x.k] || x.k : x.k)} <small class="adm-muted">${x.n} pedido(s)</small></span><b>${money ? brl(x.v) : x.n}</b><i style="--w:${Math.round(Number(x.v) / tot * 100)}%"></i></div>`).join('') || '<p class="adm-muted">Sem dados no período.</p>'; };
  const empty = (t) => `<p class="adm-empty">${t}</p>`;

  async function load() {
    if (busy || typeof R === 'undefined' || !R) return; busy = true;
    $('#rep-body').innerHTML = empty('Carregando…');
    const { data, error } = await sb.rpc('reports_data', { p_rid: R.id, p_days: days });
    busy = false;
    if (error) { $('#rep-body').innerHTML = empty('Não foi possível carregar os relatórios agora.'); return; }
    D = data; render();
  }
  function render() {
    if (!D) return;
    if (tab === 'avaliacoes') { avaliacoes(); return; }
    const f = { clientes, vendas, itens, entregas, equipe, funil }[tab];
    $('#rep-body').innerHTML = f();
  }

  /* ---------- clientes ---------- */
  function clientes() {
    const all = D.clients || [];
    const act = all.filter((c) => ago(c.last) <= 30), ina = all.filter((c) => ago(c.last) > 30), pot = D.potential || [];
    const list = (cf === 'ativos' ? act : cf === 'inativos' ? ina : cf === 'potencial' ? pot : all)
      .filter((c) => !cq || `${c.name} ${c.phone}`.toLowerCase().includes(cq));
    const top = all.slice(0, 10);
    return `<section class="adm-kpis">
        <button type="button" class="adm-kpi kpi-btn ${cf === 'todos' ? 'on' : ''}" data-cf="todos"><span>Todos os clientes</span><b>${all.length}</b><small>com WhatsApp</small></button>
        <button type="button" class="adm-kpi kpi-btn ${cf === 'ativos' ? 'on' : ''}" data-cf="ativos"><span>Ativos</span><b>${act.length}</b><small>pediram nos últimos 30 dias</small></button>
        <button type="button" class="adm-kpi kpi-btn ${cf === 'inativos' ? 'on' : ''}" data-cf="inativos"><span>Inativos</span><b>${ina.length}</b><small>sem pedir há mais de 30 dias</small></button>
        <button type="button" class="adm-kpi kpi-btn ${cf === 'potencial' ? 'on' : ''}" data-cf="potencial"><span>Em potencial</span><b>${pot.length}</b><small>começaram e não pagaram</small></button>
      </section>
      ${cf === 'todos' && top.length ? `<div class="p-card"><h2>Top 10 clientes</h2><div class="rx-list">${top.map((c, i) => `<div class="rx-row"><span class="top-n">${i + 1}</span><div class="rx-main"><b>${esc(c.name)}</b><small class="adm-muted">${c.orders} pedido(s) · último em ${dt(c.last)}</small></div><b>${brl(c.total)}</b></div>`).join('')}</div></div>` : ''}
      <div class="p-card">
        <div class="rx-card-head"><h2>${{ todos: 'Clientes', ativos: 'Clientes ativos', inativos: 'Clientes inativos', potencial: 'Clientes em potencial' }[cf]}</h2>
          <div class="rep-acts"><input type="search" id="rep-cq" placeholder="Buscar nome ou telefone" value="${esc(cq)}"><button class="btn btn-outline" type="button" id="rep-csv">Exportar planilha</button></div></div>
        ${cf === 'inativos' && list.length ? '<p class="adm-muted">Chame quem sumiu: toque em WhatsApp e mande um cupom de volta.</p>' : ''}
        <div class="rep-table"><table><thead><tr><th>Cliente</th><th>WhatsApp</th>${cf === 'potencial' ? '<th>Tentou pedir em</th>' : '<th>Pedidos</th><th>Total gasto</th><th>Último pedido</th>'}<th></th></tr></thead>
        <tbody>${list.slice(0, 300).map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(fmtPhone(c.phone))}</td>${cf === 'potencial' ? `<td>${dt(c.last)}</td>` : `<td>${c.orders}</td><td>${brl(c.total)}</td><td>${dt(c.last)}${ago(c.last) > 30 ? ` <small class="adm-muted">(${ago(c.last)} dias)</small>` : ''}</td>`}<td><a class="btn btn-ghost sm" href="${wa(c.phone, c.name)}" target="_blank" rel="noopener">WhatsApp</a></td></tr>`).join('') || `<tr><td colspan="6">${empty('Nenhum cliente aqui.')}</td></tr>`}</tbody></table></div>
        ${list.length > 300 ? `<p class="adm-muted">Mostrando 300 de ${list.length}. Use a busca ou exporte a planilha.</p>` : ''}
      </div>`;
  }
  function csv() {
    const all = cf === 'potencial' ? (D.potential || []) : (D.clients || []).filter((c) => (cf === 'ativos' ? ago(c.last) <= 30 : cf === 'inativos' ? ago(c.last) > 30 : true));
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Nome', 'WhatsApp', 'Pedidos', 'Total gasto', 'Primeiro pedido', 'Último pedido'].join(';')]
      .concat(all.map((c) => [q(c.name), q(fmtPhone(c.phone)), c.orders ?? '', c.total != null ? String(Number(c.total).toFixed(2)).replace('.', ',') : '', dt(c.first), dt(c.last)].join(';')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clientes-${R.slug}-${cf}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- vendas ---------- */
  function vendas() {
    const t = D.tickets || {};
    return `<section class="adm-kpis">
        <div class="adm-kpi"><span>Total vendido</span><b>${brl(t.total)}</b><small>${t.orders || 0} pedido(s)</small></div>
        <div class="adm-kpi"><span>Ticket médio</span><b>${brl(t.avg)}</b><small>menor ${brl(t.min)} · maior ${brl(t.max)}</small></div>
        <div class="adm-kpi"><span>Itens por pedido</span><b>${Number(t.items_avg || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</b><small>em média</small></div>
        <div class="adm-kpi"><span>Taxas de entrega</span><b>${brl(t.fees)}</b><small>descontos dados: ${brl(t.discounts)}</small></div>
      </section>
      <div class="rx-grid"><div class="p-card"><h2>Formas de pagamento</h2><div class="fin-split">${split(D.payments || [], PAY)}</div></div>
      <div class="p-card"><h2>Bairros e regiões</h2><div class="fin-split">${split((D.zones || []).map((z) => ({ k: z.name, n: z.n, v: z.v })))}</div></div></div>`;
  }
  /* ---------- itens ---------- */
  function itens() {
    const it = D.items || [];
    if (!it.length) return empty('Sem vendas no período.');
    const max = Math.max(...it.map((x) => x.qty));
    return `<div class="p-card"><h2>Itens mais vendidos</h2><div class="rep-table"><table><thead><tr><th>#</th><th>Item</th><th>Quantidade</th><th>Faturamento</th><th></th></tr></thead><tbody>
      ${it.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.name)}</b></td><td>${x.qty}</td><td>${brl(x.v)}</td><td class="rep-bar"><i style="width:${Math.round(x.qty / max * 100)}%"></i></td></tr>`).join('')}</tbody></table></div></div>`;
  }
  /* ---------- entregas ---------- */
  function entregas() {
    const c = D.couriers || [], z = D.zones || [];
    return `<div class="rx-grid">
      <div class="p-card"><h2>Por motoboy</h2>${c.length ? `<div class="rep-table"><table><thead><tr><th>Motoboy</th><th>Entregas</th><th>Taxas</th><th>Tempo até sair</th></tr></thead><tbody>${c.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${x.n}</td><td>${brl(x.fees)}</td><td>${x.mins != null ? `${x.mins} min` : '—'}</td></tr>`).join('')}</tbody></table></div><p class="adm-muted">"Tempo até sair" é a média entre o pedido chegar e sair para entrega.</p>` : empty('Nenhuma entrega no período.')}</div>
      <div class="p-card"><h2>Por bairro / região</h2>${z.length ? `<div class="rep-table"><table><thead><tr><th>Região</th><th>Pedidos</th><th>Vendido</th><th>Taxas</th></tr></thead><tbody>${z.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${x.n}</td><td>${brl(x.v)}</td><td>${brl(x.fees)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhuma entrega no período.')}</div></div>`;
  }
  /* ---------- garçons e cupons ---------- */
  function equipe() {
    const w = D.waiters || [], cp = D.coupons || [];
    return `<div class="rx-grid">
      <div class="p-card"><h2>Garçons</h2>${w.length ? `<div class="rep-table"><table><thead><tr><th>Garçom</th><th>Pedidos</th><th>Vendido</th></tr></thead><tbody>${w.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${x.n}</td><td>${brl(x.v)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhum pedido lançado por garçom no período.')}</div>
      <div class="p-card"><h2>Cupons</h2>${cp.length ? `<div class="rep-table"><table><thead><tr><th>Cupom</th><th>Usos</th><th>Desconto dado</th><th>Vendido com ele</th></tr></thead><tbody>${cp.map((x) => `<tr><td><b>${esc(x.code)}</b></td><td>${x.n}</td><td>${brl(x.disc)}</td><td>${brl(x.v)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhum cupom usado no período.')}</div></div>`;
  }
  /* ---------- funil ---------- */
  function funil() {
    const f = D.funnel || {};
    const steps = [['visits', 'Visitaram o cardápio', 'Abriram o link da loja'], ['views', 'Abriram um produto', 'Tocaram em algum item'], ['carts', 'Colocaram na sacola', 'Adicionaram algum item'], ['checkouts', 'Foram finalizar', 'Chegaram na tela de finalizar'], ['orders', 'Fizeram o pedido', 'Pedidos feitos pelo cardápio']];
    const top = Math.max(1, Number(f.visits) || 0);
    const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const tips = [];
    if (f.visits && pct(f.views, f.visits) < 50) tips.push('Muita gente entra e não abre nenhum produto: capriche nas fotos e use Destaques.');
    if (f.views && pct(f.carts, f.views) < 30) tips.push('Abrem o produto mas não colocam na sacola: revise preços e descrições, ou crie uma promoção.');
    if (f.checkouts && pct(f.orders, f.checkouts) < 60) tips.push('Desistem na finalização: confira a taxa de entrega, o pedido mínimo e as formas de pagamento.');
    if (!f.visits) tips.push('Divulgue o link do cardápio no Instagram, no status do WhatsApp e no Google para trazer visitas.');
    return `<div class="p-card"><h2>Funil do cardápio</h2><p class="adm-muted">Cada pessoa conta uma vez por visita. Pedidos de mesa e de balcão não entram aqui.</p>
      <div class="funnel">${steps.map(([k, l, s], i) => { const v = Number(f[k]) || 0; const prev = i ? Number(f[steps[i - 1][0]]) || 0 : v; return `<div class="fn-row"><div class="fn-bar" style="--w:${Math.max(4, Math.round(v / top * 100))}%"><b>${v}</b></div><div><b>${l}</b><small class="adm-muted">${s}${i ? ` · ${pct(v, prev)}% da etapa anterior` : ''}</small></div></div>`; }).join('')}</div>
      ${tips.length ? `<ul class="ms-tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <p class="adm-muted">O funil começou a contar a partir desta atualização do sistema.</p></div>`;
  }

  /* ---------- avaliações ---------- */
  async function avaliacoes() {
    $('#rep-body').innerHTML = empty('Carregando…');
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await sb.from('order_ratings').select('stars, comment, created_at, orders(number, customer_name, customer_phone)')
      .eq('restaurant_id', R.id).gte('created_at', since).order('created_at', { ascending: false }).limit(500);
    if (tab !== 'avaliacoes') return;
    if (error) { $('#rep-body').innerHTML = empty('Não foi possível carregar as avaliações.'); return; }
    const L = data || [];
    if (!L.length) { $('#rep-body').innerHTML = `<div class="p-card"><h2>Avaliações</h2><p class="adm-muted">Ainda não há avaliações no período. Quando o pedido é marcado como entregue, o cliente vê as estrelinhas na tela de acompanhamento do pedido. A nota da loja aparece no cardápio a partir de 5 avaliações.</p></div>`; return; }
    const avg = L.reduce((s, r) => s + r.stars, 0) / L.length;
    const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: L.filter((r) => r.stars === n).length }));
    const bad = L.filter((r) => r.stars <= 3);
    $('#rep-body').innerHTML = `<section class="adm-kpis">
        <div class="adm-kpi"><span>Nota média</span><b>★ ${avg.toFixed(1).replace('.', ',')}</b><small>${L.length} avaliação(ões)</small></div>
        <div class="adm-kpi"><span>Satisfeitos (4 e 5)</span><b>${Math.round(L.filter((r) => r.stars >= 4).length / L.length * 100)}%</b></div>
        <div class="adm-kpi"><span>Para dar atenção (1 a 3)</span><b>${bad.length}</b></div>
      </section>
      <div class="rx-grid"><div class="p-card"><h2>Distribuição</h2><div class="fin-split">${dist.map((x) => `<div class="fs"><span>${'★'.repeat(x.n)}</span><b>${x.c}</b><i style="--w:${Math.round(x.c / L.length * 100)}%"></i></div>`).join('')}</div></div>
      <div class="p-card"><h2>Comentários</h2><div class="rx-list">${L.filter((r) => r.comment).slice(0, 100).map((r) => {
        const o = r.orders || {}; const ph = digits(o.customer_phone).replace(/^55(?=\d{10,11}$)/, '');
        return `<div class="rx-row rate-row ${r.stars <= 3 ? 'low' : ''}"><div class="rx-main"><b>${'★'.repeat(r.stars)}<span class="adm-muted">${'★'.repeat(5 - r.stars)}</span> · ${esc(o.customer_name || 'Cliente')}${o.number ? ` · #${o.number}` : ''}</b><small>${esc(r.comment)}</small><small class="adm-muted">${dt(r.created_at)}</small></div>${r.stars <= 3 && ph.length >= 10 ? `<a class="btn btn-ghost sm" href="${wa(ph, o.customer_name)}" target="_blank" rel="noopener">Responder</a>` : ''}</div>`;
      }).join('') || empty('Ninguém deixou comentário ainda, só estrelas.')}</div></div></div>`;
  }

  $$('[data-rp]').forEach((b) => b.addEventListener('click', () => { days = +b.dataset.rp; $$('[data-rp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); if (tab === 'avaliacoes') avaliacoes(); else load(); }));
  $$('[data-rt]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.rt; $$('[data-rt]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); render(); }));
  $('#rep-body').addEventListener('click', (e) => {
    const k = e.target.closest('[data-cf]'); if (k) { cf = k.dataset.cf; render(); return; }
    if (e.target.closest('#rep-csv')) csv();
  });
  $('#rep-body').addEventListener('input', (e) => {
    if (e.target.id !== 'rep-cq') return; cq = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart; render(); const i = $('#rep-cq'); i.focus(); i.setSelectionRange(pos, pos);
  });
  return { load };
})();
