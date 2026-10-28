/* ============================================================
   BoraLanchar! — PDV: lançar pedido no balcão ou por telefone
   Usa o que o painel.js já carregou: sb, R, CATS, PRODS, brl, esc, num, digits, toast.
   Banco: owner_place_order (supabase/etapa1-pedidos.sql)
   ============================================================ */
window.BoraPDV = (() => {
  let dlg = null, cart = [], cat = 0, q = '';
  const prods = () => PRODS.filter((p) => p.available);
  const P = (id) => PRODS.find((p) => p.id === id);
  const base = (p) => (p.promo_price != null && Number(p.promo_price) < Number(p.price) ? Number(p.promo_price) : Number(p.price));
  const optById = (pid, id) => { for (const g of P(pid).options || []) for (const o of g.items || []) if (o.id === id) return { g, o }; return null; };
  const unit = (l) => base(P(l.pid)) + (l.opts || []).reduce((s, id) => { const x = optById(l.pid, id); return s + (x && x.g.kind !== 'remove' ? Number(x.o.price || 0) : 0); }, 0);
  const labels = (l) => (l.opts || []).map((id) => optById(l.pid, id)).filter(Boolean).map(({ g, o }) => (g.kind === 'remove' ? `Sem ${o.name}` : g.kind === 'add' ? `+ ${o.name}` : o.name));

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'pdv'; dlg.setAttribute('aria-labelledby', 'pdv-title');
    dlg.innerHTML = `<form class="pdv-wrap" id="pdv-form" novalidate>
      <header class="pdv-head"><h2 id="pdv-title">Novo pedido</h2><span class="adm-muted">Balcão ou telefone</span><button class="close" type="button" data-pdvclose aria-label="Fechar"><svg width="20" height="20"><use href="#i-close"/></svg></button></header>
      <div class="pdv-body">
        <section class="pdv-menu" aria-label="Cardápio">
          <input class="pdv-q" id="pdv-q" type="search" placeholder="Buscar produto (atalho: /)" autocomplete="off">
          <div class="pdv-cats" id="pdv-cats"></div>
          <div class="pdv-grid" id="pdv-grid"></div>
        </section>
        <section class="pdv-side" aria-label="Pedido">
          <div class="pdv-lines" id="pdv-lines"></div>
          <div class="pdv-seg" role="radiogroup" aria-label="Tipo do pedido">
            <label><input type="radio" name="mode" value="retirada" checked><span>Balcão / retirada</span></label>
            <label><input type="radio" name="mode" value="entrega"><span>Entrega</span></label>
          </div>
          <div class="row2"><div class="field"><label for="pdv-nome">Cliente</label><input id="pdv-nome" name="nome" maxlength="80" placeholder="Nome (opcional no balcão)"></div>
          <div class="field"><label for="pdv-tel">WhatsApp</label><input id="pdv-tel" name="tel" type="tel" inputmode="tel" maxlength="20" placeholder="(00) 00000-0000"></div></div>
          <div id="pdv-ent" hidden>
            <div class="field"><label for="pdv-end">Endereço de entrega</label><input id="pdv-end" name="end" maxlength="300" placeholder="Rua, número, bairro, referência"></div>
            <div class="field"><label for="pdv-fee">Taxa de entrega (R$)</label><input id="pdv-fee" name="fee" inputmode="decimal" placeholder="0,00"></div>
          </div>
          <div class="pdv-pay" role="radiogroup" aria-label="Pagamento">
            ${[['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['cartao', 'Cartão']].map(([k, l], i) => `<label><input type="radio" name="pay" value="${k}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          </div>
          <div class="row2"><div class="field" id="pdv-troco-f"><label for="pdv-troco">Troco para (R$)</label><input id="pdv-troco" name="troco" inputmode="decimal" placeholder="Opcional"></div>
          <div class="field"><label for="pdv-desc">Desconto (R$)</label><input id="pdv-desc" name="desc" inputmode="decimal" placeholder="0,00"></div></div>
          <div class="field"><label for="pdv-obs">Observação</label><input id="pdv-obs" name="obs" maxlength="300" placeholder="Ex.: sem cebola em tudo"></div>
          <label class="check"><input type="checkbox" name="paid"> <span>Já está pago</span></label>
          <div class="pdv-tot" id="pdv-tot"></div>
          <p class="err" id="pdv-err" role="alert"></p>
          <button class="btn btn-primary btn-block pdv-go" type="submit" id="pdv-go">Gerar pedido</button>
        </section>
      </div>
      <div class="pdv-opt" id="pdv-opt" hidden></div>
    </form>`;
    document.body.appendChild(dlg);
    const f = $('#pdv-form');
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-pdvclose]')) close(); });
    dlg.addEventListener('cancel', (e) => { if (!$('#pdv-opt').hidden) { e.preventDefault(); $('#pdv-opt').hidden = true; } });
    $('#pdv-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); grid(); });
    $('#pdv-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; cat = +b.dataset.c; cats(); grid(); });
    $('#pdv-grid').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; const p = P(+b.dataset.p); if ((p.options || []).length) optSheet(p); else add(p.id, []); });
    $('#pdv-lines').addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (!b) return; const l = cart[+b.dataset.l]; l.qty += +b.dataset.d; if (l.qty <= 0) cart.splice(+b.dataset.l, 1); lines(); });
    f.addEventListener('change', sync); f.addEventListener('input', (e) => { if (['fee', 'desc'].includes(e.target.name)) totals(); });
    f.addEventListener('submit', submit);
    dlg.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('#pdv-q').focus(); } });
  }
  function cats() {
    const used = CATS.filter((c) => prods().some((p) => p.category_id === c.id));
    $('#pdv-cats').innerHTML = [{ id: 0, name: 'Tudo' }, ...used].map((c) => `<button type="button" data-c="${c.id}" aria-pressed="${cat === c.id}">${esc(c.name)}</button>`).join('');
  }
  function grid() {
    const list = prods().filter((p) => (!cat || p.category_id === cat) && (!q || p.name.toLowerCase().includes(q)));
    $('#pdv-grid').innerHTML = list.map((p) => `<button type="button" class="pdv-item" data-p="${p.id}">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : ''}<b>${esc(p.name)}</b><span>${brl(base(p))}${(p.options || []).length ? ' · opções' : ''}</span></button>`).join('')
      || '<p class="adm-empty">Nenhum produto disponível encontrado.</p>';
  }
  function add(pid, opts, note = '') {
    const k = [...opts].sort().join();
    const same = cart.find((l) => l.pid === pid && [...l.opts].sort().join() === k && l.note === note);
    if (same) same.qty++; else cart.push({ pid, qty: 1, opts, note });
    lines();
  }
  function optSheet(p) {
    const box = $('#pdv-opt');
    box.innerHTML = `<div class="pdv-opt-card" role="dialog" aria-label="${esc(p.name)}"><h3>${esc(p.name)}</h3>${(p.options || []).map((g) => `<fieldset data-kind="${g.kind}" data-max="${g.max || ''}"><legend>${esc(g.title)}${g.kind === 'choose' ? ' <em>obrigatório</em>' : ''}</legend>
      ${(g.items || []).map((o) => `<label><input type="${g.kind === 'choose' ? 'radio' : 'checkbox'}" name="g${esc(g.id)}" value="${esc(o.id)}"><span>${g.kind === 'remove' ? 'Sem ' : ''}${esc(o.name)}</span>${Number(o.price) > 0 ? `<small>+ ${brl(o.price)}</small>` : ''}</label>`).join('')}</fieldset>`).join('')}
      <div class="field"><label for="pdv-onote">Observação do item</label><input id="pdv-onote" maxlength="140" placeholder="Ex.: bem passado"></div>
      <p class="err" id="pdv-oerr"></p>
      <div class="pdv-opt-acts"><button class="btn btn-ghost" type="button" data-ocancel>Cancelar</button><button class="btn btn-primary" type="button" data-ook>Adicionar</button></div></div>`;
    box.hidden = false;
    $('[data-ocancel]', box).onclick = () => { box.hidden = true; };
    $('[data-ook]', box).onclick = () => {
      const opts = []; let bad = null;
      [...box.querySelectorAll('fieldset')].forEach((fs) => {
        const sel = [...fs.querySelectorAll('input:checked')].map((i) => i.value); const t = fs.querySelector('legend').textContent.replace(' obrigatório', '');
        if (fs.dataset.kind === 'choose' && sel.length !== 1 && !bad) bad = `Escolha uma opção em "${t}".`;
        if (fs.dataset.max && sel.length > +fs.dataset.max && !bad) bad = `Escolha no máximo ${fs.dataset.max} em "${t}".`;
        opts.push(...sel);
      });
      if (bad) { $('#pdv-oerr').textContent = bad; return; }
      add(p.id, opts, $('#pdv-onote').value.trim()); box.hidden = true;
    };
  }
  function lines() {
    $('#pdv-lines').innerHTML = cart.length ? cart.map((l, i) => { const lb = labels(l); return `<div class="pdv-line"><div><b>${esc(P(l.pid).name)}</b>${lb.length ? `<small>${lb.map(esc).join(' · ')}</small>` : ''}${l.note ? `<small>Obs.: ${esc(l.note)}</small>` : ''}</div>
      <div class="pdv-qty"><button type="button" data-l="${i}" data-d="-1" aria-label="Tirar um">−</button><span>${l.qty}</span><button type="button" data-l="${i}" data-d="1" aria-label="Mais um">+</button></div><span class="pdv-lp">${brl(unit(l) * l.qty)}</span></div>`; }).join('')
      : '<p class="adm-empty">Toque nos produtos para montar o pedido.</p>';
    totals();
  }
  function calc() {
    const f = $('#pdv-form'); const ent = f.mode.value === 'entrega';
    const sub = cart.reduce((s, l) => s + unit(l) * l.qty, 0);
    const fee = ent ? num(f.fee.value) : 0; const desc = Math.min(num(f.desc.value), sub + fee);
    return { sub, fee, desc, total: sub + fee - desc, ent };
  }
  function totals() {
    const t = calc();
    $('#pdv-tot').innerHTML = `<div><span>Subtotal</span><span>${brl(t.sub)}</span></div>${t.ent ? `<div><span>Entrega</span><span>${t.fee > 0 ? brl(t.fee) : 'Grátis'}</span></div>` : ''}${t.desc > 0 ? `<div><span>Desconto</span><span>− ${brl(t.desc)}</span></div>` : ''}<div class="big"><span>Total</span><span>${brl(t.total)}</span></div>`;
    $('#pdv-go').textContent = cart.length ? `Gerar pedido · ${brl(t.total)}` : 'Gerar pedido';
  }
  function sync() {
    const f = $('#pdv-form');
    $('#pdv-ent').hidden = f.mode.value !== 'entrega';
    $('#pdv-troco-f').hidden = f.pay.value !== 'dinheiro';
    totals();
  }
  async function submit(e) {
    e.preventDefault();
    const f = $('#pdv-form'); const err = $('#pdv-err'); err.textContent = '';
    if (!cart.length) { err.textContent = 'Adicione pelo menos um produto.'; return; }
    const t = calc();
    if (t.ent && f.end.value.trim().length < 5) { err.textContent = 'Informe o endereço de entrega.'; f.end.focus(); return; }
    if (f.tel.value.trim() && digits(f.tel.value).length < 10) { err.textContent = 'Informe o WhatsApp com DDD ou deixe em branco.'; f.tel.focus(); return; }
    const troco = f.pay.value === 'dinheiro' && f.troco.value.trim() ? num(f.troco.value) : null;
    if (troco !== null && troco < t.total) { err.textContent = 'O troco precisa ser maior que o total.'; f.troco.focus(); return; }
    const b = $('#pdv-go'); b.disabled = true;
    const { data, error } = await sb.rpc('owner_place_order', {
      p_rid: R.id,
      p_customer: { name: f.nome.value.trim(), phone: f.tel.value.trim(), mode: f.mode.value, address: t.ent ? f.end.value.trim() : null, payment: f.pay.value,
        change_for: troco ? String(troco) : '', notes: f.obs.value.trim(), fee: t.ent ? String(t.fee) : '', discount: String(t.desc), paid: f.paid.checked ? 'true' : '' },
      p_items: cart.map((l) => ({ product_id: l.pid, qty: l.qty, note: l.note, options: l.opts })),
    });
    b.disabled = false;
    if (error) { err.textContent = (error.message || 'Não foi possível gerar o pedido.').replace(/^.*?:\s*/, ''); return; }
    toast(`Pedido #${data.number} lançado!`);
    reset(); close();
  }
  function reset() {
    cart = []; q = ''; cat = 0;
    const f = $('#pdv-form'); f.reset(); f.fee.value = Number(R.delivery_fee) > 0 ? money(R.delivery_fee) : '';
    $('#pdv-q').value = ''; $('#pdv-err').textContent = ''; $('#pdv-opt').hidden = true;
  }
  function open() {
    if (!dlg) { build(); reset(); }
    if (!prods().length) { toast('Cadastre produtos disponíveis na aba Cardápio primeiro.'); return; }
    cats(); grid(); lines(); sync();
    dlg.showModal();
    if (matchMedia('(pointer: fine)').matches) $('#pdv-q').focus();
  }
  function close() { if (cart.length && dlg.open && !confirm('Fechar sem gerar o pedido? Os itens escolhidos serão descartados.')) return; cart = []; dlg.close(); }
  return { open };
})();
