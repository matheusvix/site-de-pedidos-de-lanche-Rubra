/* ============================================================
   Rubra — painel administrativo
   Login real via Supabase Auth; dados protegidos por RLS
   (só e-mails da tabela public.admins leem os leads).
   ============================================================ */
const CFG = window.RUBRA_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const STATUS = { novo: 'Novo', em_contato: 'Em contato', convertido: 'Convertido', perdido: 'Perdido' };
const ORIGEM = { cadastro: 'Teste grátis', consultor: 'Especialista' };

// O link do convite/redefinição chega com #...type=invite|recovery
const hashType = new URLSearchParams(location.hash.slice(1)).get('type');
let mustSetPassword = hashType === 'invite' || hashType === 'recovery';

/* ---------- utilidades ---------- */
const toastEl = $('.toast');
let tt;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(tt);
  tt = setTimeout(() => toastEl.classList.remove('show'), 3200);
}
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  kids.flat().forEach((c) => c != null && n.append(c));
  return n;
}
const fmtDate = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const digits = (s) => (s || '').replace(/\D/g, '');
function waLink(tel) {
  let d = digits(tel);
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}`;
}
function show(view) {
  ['login', 'password', 'message', 'app'].forEach((v) => { $(`#view-${v}`).hidden = v !== view; });
}
function message(title, text, btnLabel = 'Sair') {
  $('#msg-title').textContent = title;
  $('#msg-text').textContent = text;
  $('#msg-btn').textContent = btnLabel;
  show('message');
}

/* ---------- inicialização ---------- */
if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) {
  message('Configuração pendente', 'Preencha supabaseUrl e supabaseAnonKey em assets/config.js e publique novamente.', 'Voltar ao site');
  $('#msg-btn').addEventListener('click', () => { location.href = 'index.html'; });
  throw new Error('Supabase não configurado');
}
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

let leads = [];
let current = null;

async function route() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show('login'); return; }
  if (mustSetPassword) { show('password'); return; }

  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    message('Sem permissão', `A conta ${session.user.email} não é administradora deste painel.`);
    return;
  }
  $('#who').textContent = session.user.email;
  show('app');
  loadLeads();
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { mustSetPassword = true; show('password'); }
  if (event === 'SIGNED_OUT') show('login');
});

/* ---------- login / senha / sair ---------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button[type="submit"]', e.target);
  const email = $('#a-email').value.trim();
  const password = $('#a-senha').value;
  $('#login-err').textContent = '';
  if (!email || !password) { $('#login-err').textContent = 'Preencha e-mail e senha.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { $('#login-err').textContent = 'E-mail ou senha incorretos.'; return; }
  route();
});

$('#forgot').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = $('#a-email').value.trim();
  if (!email) { $('#login-err').textContent = 'Digite seu e-mail para receber o link.'; return; }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  toast('Se o e-mail tiver conta, o link de redefinição foi enviado.');
});

$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('#p1').value, p2 = $('#p2').value;
  const err = $('#pass-err');
  err.textContent = '';
  if (p1.length < 8) { err.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
  if (p1 !== p2) { err.textContent = 'As senhas não conferem.'; return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { err.textContent = 'Não foi possível salvar: ' + error.message; return; }
  mustSetPassword = false;
  history.replaceState(null, '', location.pathname);
  toast('Senha definida!');
  route();
});

async function logout() { await sb.auth.signOut(); show('login'); }
$('#logout').addEventListener('click', logout);
$('#msg-btn').addEventListener('click', logout);

/* ---------- dados ---------- */
async function loadLeads() {
  const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(5000);
  if (error) { toast('Erro ao carregar leads.'); console.error(error); return; }
  leads = data || [];
  renderKpis();
  renderRows();
}
$('#refresh').addEventListener('click', loadLeads);

function renderKpis() {
  $('#k-total').textContent = leads.length;
  ['novo', 'em_contato', 'convertido'].forEach((s) => { $(`#k-${s}`).textContent = leads.filter((l) => l.status === s).length; });
  const week = Date.now() - 7 * 864e5;
  $('#k-7d').textContent = leads.filter((l) => new Date(l.created_at).getTime() >= week).length;
}

function filtered() {
  const q = $('#f-q').value.trim().toLowerCase();
  const tipo = $('#f-tipo').value, status = $('#f-status').value, plano = $('#f-plano').value;
  return leads.filter((l) =>
    (!tipo || l.tipo === tipo) &&
    (!status || l.status === status) &&
    (!plano || l.plano === plano) &&
    (!q || [l.nome, l.loja, l.email, l.telefone].some((v) => (v || '').toLowerCase().includes(q)))
  );
}
['#f-q', '#f-tipo', '#f-status', '#f-plano'].forEach((s) => $(s).addEventListener('input', renderRows));

function renderRows() {
  const list = filtered();
  const tbody = $('#rows');
  tbody.replaceChildren(...list.map((l) => el('tr', {},
    el('td', {}, el('small', { text: fmtDate(l.created_at) })),
    el('td', {}, el('b', { text: l.nome }), el('small', { text: l.telefone || l.email || '—' })),
    el('td', {}, el('b', { text: l.loja }), el('small', { text: l.segmento || '' })),
    el('td', {}, el('span', { class: 'origin', text: ORIGEM[l.tipo] || l.tipo })),
    el('td', { text: l.plano || '—' }),
    el('td', {}, el('span', { class: `st st-${l.status}`, text: STATUS[l.status] || l.status })),
    el('td', {}, el('button', { class: 'btn btn-outline row-btn', type: 'button', text: 'Abrir', onclick: () => openLead(l) })),
  )));
  $('#empty').hidden = list.length > 0;
}

/* ---------- detalhe ---------- */
const dlg = $('#lead-dialog');
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

function openLead(l) {
  current = l;
  $('#ld-title').textContent = l.nome;
  $('#ld-sub').textContent = `${ORIGEM[l.tipo] || l.tipo} · ${fmtDate(l.created_at)}`;
  const rows = [
    ['Estabelecimento', l.loja], ['WhatsApp', l.telefone], ['E-mail', l.email], ['Segmento', l.segmento],
    ['Plano', l.plano], ['Assunto', l.assunto], ['Mensagem', l.mensagem],
  ].filter(([, v]) => v);
  $('#ld-data').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
  $('#ld-status').value = l.status;
  $('#ld-notas').value = l.notas || '';
  const wa = waLink(l.telefone);
  const waBtn = $('#ld-wa');
  waBtn.hidden = !wa;
  if (wa) waBtn.href = wa;
  dlg.showModal();
}

$('#ld-save').addEventListener('click', async () => {
  if (!current) return;
  const patch = { status: $('#ld-status').value, notas: $('#ld-notas').value.trim() || null };
  const { error } = await sb.from('leads').update(patch).eq('id', current.id);
  if (error) { toast('Erro ao salvar.'); console.error(error); return; }
  Object.assign(current, patch);
  dlg.close();
  renderKpis(); renderRows();
  toast('Lead atualizado.');
});

$('#ld-delete').addEventListener('click', async () => {
  if (!current || !confirm(`Excluir o lead de ${current.nome}? Isso não pode ser desfeito.`)) return;
  const { error } = await sb.from('leads').delete().eq('id', current.id);
  if (error) { toast('Erro ao excluir.'); return; }
  leads = leads.filter((l) => l.id !== current.id);
  dlg.close();
  renderKpis(); renderRows();
  toast('Lead excluído.');
});

/* ---------- exportar CSV ---------- */
$('#export').addEventListener('click', () => {
  const cols = ['created_at', 'tipo', 'nome', 'loja', 'telefone', 'email', 'segmento', 'plano', 'assunto', 'mensagem', 'status', 'notas'];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas ao abrir no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(';'), ...filtered().map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `leads-rubra-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
});

route();
