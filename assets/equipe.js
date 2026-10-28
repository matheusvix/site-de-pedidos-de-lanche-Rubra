/* ============================================================
   BoraLanchar! — Equipe: colaboradores com acesso próprio ao painel
   Dono: cadastra, edita e remove (função "equipe").
   Colaborador: o painel mostra só as abas da função dele.
   Usa o que o painel.js já carregou: sb, R, SITE, esc, toast, selectTab, $, $$.
   ============================================================ */
window.BoraEquipe = (() => {
  const ROLES = { gerente: 'Gerente', atendente: 'Atendente', cozinha: 'Cozinha' };
  const ALLOW = {
    atendente: ['pedidos', 'entregas'],
    gerente: null, // tudo, menos as abas abaixo
  };
  const HIDE_GERENTE = ['loja', 'equipe'];
  let STAFF = [];

  function applyRole(role, name) {
    if (role === 'dono') return;
    document.body.classList.add('staff-mode', 'role-' + role);
    $$('.p-tabs [data-tab]').forEach((b) => {
      const t = b.dataset.tab;
      const ok = role === 'gerente' ? !HIDE_GERENTE.includes(t) : (ALLOW[role] || []).includes(t);
      b.hidden = !ok;
    });
    if (role === 'atendente') {
      const sw = $('#auto-accept'); if (sw) sw.closest('label').hidden = true;
      const ot = $('#open-toggle'); if (ot) ot.disabled = true;
    }
    const tag = $('#store-name-tag'); if (tag) tag.textContent = `${R.name} · ${name || ROLES[role]} (${ROLES[role]})`;
    const cur = $('.p-tabs [aria-selected="true"]');
    if (!cur || cur.hidden) selectTab('pedidos');
  }

  /* ---------- cadastro (só o dono) ---------- */
  async function call(body) {
    const { data, error } = await sb.functions.invoke('equipe', { body });
    if (error) {
      let msg = 'Não foi possível agora. Tente de novo.';
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
      return { error: msg };
    }
    return data || {};
  }
  async function load() {
    const { data } = await sb.from('restaurant_staff').select('*').eq('restaurant_id', R.id).order('created_at');
    STAFF = data || []; render();
  }
  function render() {
    $('#eq-list').innerHTML = STAFF.map((s) => `<div class="rx-row" data-eq="${s.id}"><div class="rx-main"><b>${esc(s.name)}</b><small class="adm-muted">${esc(s.email)} · ${ROLES[s.role] || s.role}</small></div>
      <span class="mp-state ${s.active ? 'on' : ''}">${s.active ? 'Ativo' : 'Sem acesso'}</span><div class="rx-acts"><button class="btn btn-outline" type="button" data-eqedit>Editar</button></div></div>`).join('')
      || '<p class="adm-empty">Nenhum colaborador ainda. Cadastre quem trabalha com você para cada um ter o próprio acesso.</p>';
  }
  const rxd = () => $('#rx-dialog');
  function open(s) {
    const roleSel = `<select name="role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${s && s.role === k ? 'selected' : (!s && k === 'atendente' ? 'selected' : '')}>${l}</option>`).join('')}</select>`;
    const f = (label, html, hint = '') => `<div class="field"><label>${label}</label>${html}${hint ? `<small class="adm-muted">${hint}</small>` : ''}</div>`;
    $('#rx-title').textContent = s ? `Colaborador ${s.name}` : 'Novo colaborador';
    $('#rx-sub').textContent = s ? s.email : 'A pessoa entra no painel com este e-mail e senha.'; $('#rx-sub').hidden = false;
    $('#rx-body').innerHTML = f('Nome', `<input name="name" maxlength="60" required value="${esc(s ? s.name : '')}" placeholder="Ex.: Ana">`)
      + (s ? '' : f('E-mail', '<input name="email" type="email" maxlength="200" required autocomplete="off" placeholder="ana@email.com">'))
      + f(s ? 'Nova senha (opcional)' : 'Senha', `<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="${s ? 'Deixe em branco para manter' : 'Mínimo de 8 caracteres'}">`, s ? '' : 'Passe a senha para a pessoa. Ela pode usar "Esqueci minha senha" depois.')
      + f('Função', roleSel)
      + (s ? `<label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> <span>Pode entrar no painel</span></label>` : '');
    $('#rx-err').textContent = '';
    $('#rx-actions').innerHTML = (s ? '<button class="btn btn-ghost adm-danger" type="button" data-eqdel>Remover</button>' : '<span></span>') + `<button class="btn btn-primary" type="button" data-eqsave>${s ? 'Salvar' : 'Cadastrar'}</button>`;
    // o painel já tem olhinho nas senhas; aplica no campo novo
    const pw = $('#rx-body [name=password]'); if (pw && window.BoraOlhinho) window.BoraOlhinho(pw);
    const form = $('#rx-form');
    $('[data-eqsave]').onclick = async (e) => {
      const b = e.currentTarget; const name = form.name.value.trim(), password = form.password.value;
      if (!name) { $('#rx-err').textContent = 'Informe o nome.'; return; }
      if (!s && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim())) { $('#rx-err').textContent = 'E-mail inválido.'; return; }
      if ((!s || password) && password.length < 8) { $('#rx-err').textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
      b.disabled = true;
      const r = s ? await call({ action: 'update', id: s.id, name, role: form.role.value, active: form.active.checked, password: password || undefined })
        : await call({ action: 'create', name, email: form.email.value.trim(), password, role: form.role.value });
      b.disabled = false;
      if (r.error) { $('#rx-err').textContent = r.error; return; }
      rxd().close(); toast(s ? 'Colaborador atualizado.' : `${name} cadastrado! Passe o e-mail e a senha para ele entrar.`); load();
    };
    const del = $('[data-eqdel]');
    if (del) del.onclick = async () => {
      if (!confirm(`Remover ${s.name} da equipe? A conta dele é apagada.`)) return;
      del.disabled = true; const r = await call({ action: 'delete', id: s.id }); del.disabled = false;
      if (r.error) { $('#rx-err').textContent = r.error; return; }
      rxd().close(); toast('Colaborador removido.'); load();
    };
    rxd().showModal();
  }

  function start(role, name) {
    if (role !== 'dono') { applyRole(role, name); return; }
    $('#eq-link').textContent = `${(typeof SITE !== 'undefined' ? SITE : location.origin).replace(/^https?:\/\//, '')}/painel`;
    $('#eq-add').addEventListener('click', () => open(null));
    $('#eq-list').addEventListener('click', (e) => { const r = e.target.closest('[data-eq]'); if (r && e.target.closest('[data-eqedit]')) open(STAFF.find((x) => x.id === +r.dataset.eq)); });
    document.querySelector('.p-tabs [data-tab="equipe"]').addEventListener('click', load);
  }
  return { start };
})();
