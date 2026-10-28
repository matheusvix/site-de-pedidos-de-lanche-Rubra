/* ============================================================
   BoraLanchar! — Cardápio: nota de qualidade e edição em massa
   Usa o que o painel.js já carregou: sb, R, CATS, PRODS, brl, esc, num, money, toast, loadMenu, H, $, $$.
   ============================================================ */
window.BoraCardapio = (() => {
  /* ---------- nota do cardápio ---------- */
  const CHECKS = [
    ['foto', 'sem foto', (p) => !!p.image_url, 3],
    ['desc', 'sem descrição', (p) => (p.description || '').trim().length >= 15, 2],
    ['quebrado', 'preço redondo (ex.: 20,00 → 19,90 vende mais)', (p) => Math.round(Number(p.price) * 100) % 100 !== 0, 1],
  ];
  let open = false;
  function score() {
    const box = $('#menu-score'); if (!box) return;
    const list = PRODS.filter((p) => p.available);
    if (!list.length) { box.hidden = true; return; }
    const max = list.length * CHECKS.reduce((s, c) => s + c[3], 0);
    const got = list.reduce((s, p) => s + CHECKS.reduce((t, c) => t + (c[2](p) ? c[3] : 0), 0), 0);
    const pct = Math.round(got / max * 100);
    const miss = CHECKS.map(([k, label, ok]) => ({ k, label, items: list.filter((p) => !ok(p)) })).filter((x) => x.items.length);
    const promos = list.filter((p) => p.promo_price != null && Number(p.promo_price) < Number(p.price)).length;
    const feat = list.filter((p) => p.featured).length;
    const tips = [];
    if (!feat) tips.push('Marque 3 a 5 produtos como Destaque para eles aparecerem no topo.');
    if (!promos) tips.push('Coloque um preço promocional em algum item: ele aparece com o preço antigo riscado.');
    box.hidden = false;
    box.innerHTML = `<div class="ms-head"><div class="ms-ring" style="--p:${pct}"><b>${pct}%</b></div>
      <div><h2>Nota do cardápio</h2><p class="adm-muted">${pct >= 90 ? 'Seu cardápio está caprichado!' : pct >= 70 ? 'Bom, mas dá para vender mais com alguns ajustes.' : 'Fotos e descrições fazem o cliente pedir mais. Vale completar.'}</p></div>
      ${miss.length ? `<button class="btn btn-ghost" type="button" id="ms-toggle" aria-expanded="${open}">${open ? 'Esconder' : 'Ver o que melhorar'}</button>` : ''}</div>
      <div class="ms-body" ${open ? '' : 'hidden'}>
        ${miss.map((m) => `<div class="ms-row"><b>${m.items.length} ${m.items.length === 1 ? 'produto' : 'produtos'} ${esc(m.label)}</b><div class="ms-chips">${m.items.slice(0, 30).map((p) => `<button type="button" class="ms-chip" data-msp="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`).join('')}
        ${tips.length ? `<ul class="ms-tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      </div>`;
    const t = $('#ms-toggle'); if (t) t.onclick = () => { open = !open; score(); };
  }
  document.addEventListener('click', (e) => { const c = e.target.closest('[data-msp]'); if (c) openProduct(PRODS.find((p) => p.id === +c.dataset.msp)); });

  /* ---------- edição em massa ---------- */
  let dlg = null, rows = [];
  function build() {
    dlg = document.createElement('dialog'); dlg.className = 'mass'; dlg.setAttribute('aria-labelledby', 'mass-title');
    dlg.innerHTML = `<form class="mass-wrap" id="mass-form" novalidate>
      <header class="pdv-head"><h2 id="mass-title">Edição em massa</h2><span class="adm-muted">Mude vários produtos de uma vez e salve no fim.</span><button class="close" type="button" data-mclose aria-label="Fechar"><svg width="20" height="20"><use href="#i-close"/></svg></button></header>
      <div class="mass-tools">
        <input type="search" id="mass-q" placeholder="Buscar produto">
        <select id="mass-cat"><option value="">Todas as categorias</option></select>
        <span class="mass-sep"></span>
        <label class="mass-pct">Reajustar preços selecionados em <input id="mass-pct" inputmode="decimal" placeholder="10"> %</label>
        <button class="btn btn-outline" type="button" id="mass-apply">Aplicar</button>
      </div>
      <div class="mass-table"><table><thead><tr><th><input type="checkbox" id="mass-all" aria-label="Selecionar todos"></th><th>Produto</th><th>Preço</th><th>Promoção</th><th>Categoria</th><th>À venda</th><th>Destaque</th><th>Dias</th></tr></thead><tbody id="mass-body"></tbody></table></div>
      <footer class="mass-foot"><span class="adm-muted" id="mass-info"></span><p class="err" id="mass-err" role="alert"></p><button class="btn btn-primary" type="submit" id="mass-save">Salvar alterações</button></footer>
    </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-mclose]')) close(); });
    $('#mass-q').addEventListener('input', filterRows); $('#mass-cat').addEventListener('change', filterRows);
    $('#mass-all').addEventListener('change', (e) => { $$('#mass-body tr:not([hidden]) [data-sel]').forEach((c) => { c.checked = e.target.checked; }); });
    $('#mass-body').addEventListener('input', () => info());
    $('#mass-body').addEventListener('change', () => info());
    $('#mass-apply').addEventListener('click', () => {
      const pct = num($('#mass-pct').value); const sign = /^\s*-/.test($('#mass-pct').value) ? -1 : 1;
      if (!pct) { toast('Digite a porcentagem. Use - para baixar (ex.: -5).'); return; }
      const sel = $$('#mass-body tr:not([hidden])').filter((tr) => $('[data-sel]', tr).checked);
      if (!sel.length) { toast('Marque os produtos na primeira coluna.'); return; }
      sel.forEach((tr) => { const i = $('[data-f="price"]', tr); const v = Math.max(0, num(i.value) * (1 + sign * pct / 100)); i.value = money(Math.round(v * 100) / 100); });
      info(); toast(`Preço de ${sel.length} produto(s) reajustado. Confira e salve.`);
    });
    $('#mass-form').addEventListener('submit', save);
  }
  function rowHTML(p) {
    const days = p.days || [];
    return `<tr data-id="${p.id}" data-cat="${p.category_id || ''}" data-name="${esc(p.name.toLowerCase())}">
      <td><input type="checkbox" data-sel aria-label="Selecionar ${esc(p.name)}"></td>
      <td class="mass-name">${esc(p.name)}</td>
      <td><input data-f="price" inputmode="decimal" value="${money(p.price)}" aria-label="Preço de ${esc(p.name)}"></td>
      <td><input data-f="promo" inputmode="decimal" value="${p.promo_price != null ? money(p.promo_price) : ''}" placeholder="—" aria-label="Preço promocional de ${esc(p.name)}"></td>
      <td><select data-f="cat" aria-label="Categoria de ${esc(p.name)}">${CATS.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="" ${p.category_id ? '' : 'selected'}>Sem categoria</option></select></td>
      <td><input type="checkbox" data-f="avail" ${p.available ? 'checked' : ''} aria-label="${esc(p.name)} à venda"></td>
      <td><input type="checkbox" data-f="feat" ${p.featured ? 'checked' : ''} aria-label="${esc(p.name)} em destaque"></td>
      <td><div class="day-chips sm">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" data-day="${d}" ${days.includes(d) ? 'checked' : ''}><span>${H.CURTO[d].charAt(0).toUpperCase()}</span></label>`).join('')}</div></td></tr>`;
  }
  function read(tr) {
    const p = PRODS.find((x) => x.id === +tr.dataset.id);
    const price = num($('[data-f="price"]', tr).value); const promoTxt = $('[data-f="promo"]', tr).value.trim();
    const days = $$('[data-day]', tr).filter((c) => c.checked).map((c) => +c.dataset.day).sort();
    return { p, row: { price, promo_price: promoTxt ? num(promoTxt) : null, category_id: $('[data-f="cat"]', tr).value ? +$('[data-f="cat"]', tr).value : null,
      available: $('[data-f="avail"]', tr).checked, featured: $('[data-f="feat"]', tr).checked, days: days.length && days.length < 7 ? days : null } };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function changed() {
    return $$('#mass-body tr').map(read).filter(({ p, row }) => !same(
      { price: Number(p.price), promo_price: p.promo_price != null ? Number(p.promo_price) : null, category_id: p.category_id || null, available: !!p.available, featured: !!p.featured, days: p.days && p.days.length ? p.days.slice().sort() : null },
      { ...row, days: row.days }));
  }
  function info() { const n = changed().length; $('#mass-info').textContent = n ? `${n} produto(s) alterado(s)` : 'Nenhuma alteração ainda'; }
  function filterRows() {
    const q = $('#mass-q').value.trim().toLowerCase(), c = $('#mass-cat').value;
    $$('#mass-body tr').forEach((tr) => { tr.hidden = (q && !tr.dataset.name.includes(q)) || (c && tr.dataset.cat !== c); });
  }
  async function save(e) {
    e.preventDefault(); $('#mass-err').textContent = '';
    const ch = changed();
    if (!ch.length) { close(true); return; }
    const bad = ch.find(({ row }) => row.promo_price !== null && !(row.promo_price < row.price));
    if (bad) { $('#mass-err').textContent = `"${bad.p.name}": a promoção precisa ser menor que o preço.`; return; }
    const b = $('#mass-save'); b.disabled = true; b.textContent = 'Salvando…';
    const res = await Promise.all(ch.map(({ p, row }) => sb.from('products').update(row).eq('id', p.id)));
    b.disabled = false; b.textContent = 'Salvar alterações';
    const fail = res.filter((r) => r.error).length;
    if (fail) { $('#mass-err').textContent = `${fail} produto(s) não foram salvos. Tente de novo.`; await loadMenu(); return; }
    toast(`${ch.length} produto(s) atualizado(s).`); close(true); await loadMenu();
  }
  function openMass() {
    if (!PRODS.length) { toast('Cadastre produtos primeiro.'); return; }
    if (!dlg) build();
    $('#mass-cat').innerHTML = '<option value="">Todas as categorias</option>' + CATS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('#mass-body').innerHTML = PRODS.map(rowHTML).join(''); $('#mass-q').value = ''; $('#mass-pct').value = ''; $('#mass-all').checked = false; info();
    dlg.showModal();
  }
  function close(force) { if (!force && changed().length && !confirm('Sair sem salvar as alterações?')) return; dlg.close(); }
  $('#mass-open').addEventListener('click', openMass);
  try { if (typeof PRODS !== 'undefined' && PRODS.length) score(); } catch (_) {}
  return { score };
})();
