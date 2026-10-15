/* ============================================================
   BoraLanchar! — painel administrativo
   Login real via Supabase Auth; dados protegidos por RLS
   (só e-mails da tabela public.admins leem os leads).
   Sem Supabase configurado (ou com ?demo na URL), o painel
   abre em MODO DEMONSTRAÇÃO, com dados fictícios locais.
   ============================================================ */
const CFG = window.BORA_CONFIG || window.TILIM_CONFIG || window.RUBRA_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);

const STATUS = { novo: 'Novo', em_contato: 'Em contato', convertido: 'Convertido', perdido: 'Perdido' };
const ORIGEM = { cadastro: 'Teste grátis', consultor: 'Especialista' };

const configured = Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
const DEMO = window.BORA_DEMO === true || window.TILIM_DEMO === true || new URLSearchParams(location.search).has('demo') || !configured;
const sb = DEMO ? null : window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

// O link do convite/redefinição chega com #...type=invite|recovery
const hashType = new URLSearchParams(location.hash.slice(1)).get('type');
let mustSetPassword = !DEMO && (hashType === 'invite' || hashType === 'recovery');

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

/* ---------- dados de demonstração (fictícios) ---------- */
function demoLeads() {
  const h = 36e5;
  const ago = (hours) => new Date(Date.now() - hours * h).toISOString();
  return [
    { id: 12, created_at: ago(0.4), tipo: 'cadastro', nome: 'Juliana Prates', loja: 'Cantina da Ju', telefone: '(27) 99812-4410', email: 'juliana@exemplo.com', segmento: 'Restaurante', plano: 'Profissional', status: 'novo', notas: null },
    { id: 11, created_at: ago(2), tipo: 'consultor', nome: 'Rafael Moura', loja: 'Brasa Burger', telefone: '(27) 98877-1203', assunto: 'Dúvida sobre planos', mensagem: 'Tenho duas lojas, o plano Completo atende as duas?', status: 'novo', notas: null },
    { id: 10, created_at: ago(5), tipo: 'cadastro', nome: 'Camila Freitas', loja: 'Açaí do Porto', telefone: '(27) 99654-3321', email: 'camila@exemplo.com', segmento: 'Açaí e sorveteria', plano: 'Essencial', status: 'em_contato', notas: 'Ligar depois das 14h.' },
    { id: 9, created_at: ago(20), tipo: 'cadastro', nome: 'Diego Santana', loja: 'Pizzaria Forno Vivo', telefone: '(27) 99701-5588', email: 'diego@exemplo.com', segmento: 'Pizzaria', plano: 'Completo', status: 'convertido', notas: 'Fechou plano Completo anual.' },
    { id: 8, created_at: ago(30), tipo: 'consultor', nome: 'Patrícia Lima', loja: 'Doce Encanto', telefone: '(27) 99234-8890', assunto: 'Quero conhecer o BoraLanchar!', status: 'em_contato', notas: 'Agendada demonstração na sexta.' },
    { id: 7, created_at: ago(52), tipo: 'cadastro', nome: 'Marcos Vieira', loja: 'Sushi Mar', telefone: '(27) 98456-7712', email: 'marcos@exemplo.com', segmento: 'Japonês', plano: 'Profissional', status: 'convertido', notas: null },
    { id: 6, created_at: ago(76), tipo: 'cadastro', nome: 'Fernanda Rocha', loja: 'Lanchonete Ponto 10', telefone: '(27) 99120-6634', email: 'fernanda@exemplo.com', segmento: 'Lanchonete', plano: 'Essencial', status: 'perdido', notas: 'Achou caro neste momento.' },
    { id: 5, created_at: ago(110), tipo: 'cadastro', nome: 'Thiago Nunes', loja: 'Hamburgueria Chapa Quente', telefone: '(27) 99988-0021', email: 'thiago@exemplo.com', segmento: 'Hamburgueria', plano: 'Profissional', status: 'em_contato', notas: null },
    { id: 4, created_at: ago(150), tipo: 'consultor', nome: 'Aline Barbosa', loja: 'Café Grão Fino', telefone: '(27) 99345-1177', assunto: 'Já sou cliente — suporte', mensagem: 'Como cadastro adicionais no cardápio?', status: 'convertido', notas: 'Resolvido por vídeo.' },
    { id: 3, created_at: ago(200), tipo: 'cadastro', nome: 'Bruno Teixeira', loja: 'Restaurante Sabor Caseiro', telefone: '(27) 98712-4456', email: 'bruno@exemplo.com', segmento: 'Restaurante', plano: 'Completo', status: 'novo', notas: null },
  ];
}

let leads = [];
let current = null;

/* ---------- inicialização / rotas ---------- */
async function route() {
  if (DEMO) {
    $('#demo-banner').hidden = false;
    show('login');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show('login'); return; }
  if (mustSetPassword) { show('password'); return; }

  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    message('Sem permissão', `A conta ${session.user.email} não é administradora deste painel.`);
    return;
  }
  enterApp(session.user.email);
}

function enterApp(email) {
  $('#who').textContent = email;
  show('app');
  loadLeads();
  loadTst();
}

if (!DEMO) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { mustSetPassword = true; show('password'); }
    if (event === 'SIGNED_OUT') show('login');
  });
}

if (DEMO) {
  $('#demo-hint').hidden = false;
  $('#a-email').value = 'admin@boralanchar.demo';
  $('#a-senha').value = 'demonstracao';
}

/* ---------- login / senha / sair ---------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const email = $('#a-email').value.trim();
  const password = $('#a-senha').value;
  $('#login-err').textContent = '';
  if (!email || !password) { $('#login-err').textContent = 'Preencha e-mail e senha.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 450));
    btn.disabled = false; btn.textContent = 'Entrar';
    enterApp(email);
    return;
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { $('#login-err').textContent = 'E-mail ou senha incorretos.'; return; }
  route();
});

$('#forgot').addEventListener('click', async (e) => {
  e.preventDefault();
  if (DEMO) { toast('Na demonstração não há envio de e-mail.'); return; }
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

async function logout() {
  if (!DEMO) await sb.auth.signOut();
  show('login');
}
$('#logout').addEventListener('click', logout);
$('#msg-btn').addEventListener('click', logout);

/* ---------- dados ---------- */
async function loadLeads() {
  if (DEMO) {
    if (!leads.length) leads = demoLeads();
  } else {
    const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(5000);
    if (error) { toast('Erro ao carregar leads.'); console.error(error); return; }
    leads = data || [];
  }
  renderKpis();
  renderRows();
}
$('#refresh').addEventListener('click', () => { loadLeads(); toast('Lista atualizada.'); });

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
  $('#rows').replaceChildren(...list.map((l) => el('tr', {},
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
const delBtn = $('#ld-delete');
let deleteArmed = false;
function resetDelete() { deleteArmed = false; delBtn.textContent = 'Excluir'; }
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
dlg.addEventListener('close', resetDelete);

function openLead(l) {
  current = l;
  resetDelete();
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
  if (wa) {
    const first = (l.nome || '').trim().split(' ')[0];
    const txt = l.tipo === 'cadastro'
      ? `Olá, ${first}! Aqui é do BoraLanchar! 🍔 Seu teste grátis de 7 dias do plano ${l.plano || 'Profissional'} para o ${l.loja || 'seu estabelecimento'} está liberado. Vamos montar seu cardápio juntos? Me conta quais são os itens mais vendidos e eu já deixo tudo no ar hoje.`
      : `Olá, ${first}! Aqui é do BoraLanchar!. Recebemos seu contato${l.assunto ? ` sobre "${l.assunto}"` : ''}. Como posso te ajudar?`;
    waBtn.href = `${wa}?text=${encodeURIComponent(txt)}`;
    waBtn.textContent = l.tipo === 'cadastro' ? 'Enviar acesso no WhatsApp' : 'Responder no WhatsApp';
  }
  dlg.showModal();
}

$('#ld-save').addEventListener('click', async () => {
  if (!current) return;
  const patch = { status: $('#ld-status').value, notas: $('#ld-notas').value.trim() || null };
  if (!DEMO) {
    const { error } = await sb.from('leads').update(patch).eq('id', current.id);
    if (error) { toast('Erro ao salvar.'); console.error(error); return; }
  }
  Object.assign(current, patch);
  dlg.close();
  renderKpis(); renderRows();
  toast('Lead atualizado.');
});

// Exclusão em dois cliques (sem caixa de diálogo do navegador)
delBtn.addEventListener('click', async () => {
  if (!current) return;
  if (!deleteArmed) { deleteArmed = true; delBtn.textContent = 'Clique de novo para excluir'; return; }
  if (!DEMO) {
    const { error } = await sb.from('leads').delete().eq('id', current.id);
    if (error) { toast('Erro ao excluir.'); return; }
  }
  leads = leads.filter((l) => l.id !== current.id);
  dlg.close();
  renderKpis(); renderRows();
  toast('Lead excluído.');
});

/* ---------- exportar CSV ---------- */
$('#export').addEventListener('click', () => {
  if (DEMO) { toast('Na demonstração a exportação fica desativada.'); return; }
  const cols = ['created_at', 'tipo', 'nome', 'loja', 'telefone', 'email', 'segmento', 'plano', 'assunto', 'mensagem', 'status', 'notas'];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas ao abrir no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.join(';'), ...filtered().map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `leads-boralanchar-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
});

/* ---------- depoimentos ---------- */
let tst = [];
let tFilter = 'pendente';
function demoTst() {
  const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
  return [
    { id: 3, created_at: ago(1), nome: 'Camila Freitas', loja: 'Açaí do Porto', cidade: 'Vitória', segmento: 'Açaí e sorveteria', texto: '(Demonstração) Depoimento enviado pelo formulário do site aguardando sua aprovação.', status: 'pendente' },
    { id: 2, created_at: ago(9), nome: 'Diego Santana', loja: 'Pizzaria Forno Vivo', cidade: 'Serra', segmento: 'Pizzaria', texto: '(Demonstração) Depoimentos aprovados passam a aparecer no carrossel da página inicial.', status: 'pendente' },
    { id: 1, created_at: ago(40), nome: 'Marcos Vieira', loja: 'Sushi Mar', cidade: 'Vila Velha', segmento: 'Japonês', texto: '(Demonstração) Depoimentos ocultos ficam guardados aqui e saem do site.', status: 'oculto' },
  ];
}
async function loadTst() {
  if (DEMO) { if (!tst.length) tst = demoTst(); }
  else {
    const { data, error } = await sb.from('testimonials').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { toast('Erro ao carregar depoimentos.'); console.error(error); return; }
    tst = data || [];
  }
  renderTst();
}
function renderTst() {
  ['pendente', 'aprovado', 'oculto'].forEach((k) => { $(`#tc-${k}`).textContent = tst.filter((t) => t.status === k).length; });
  const list = tst.filter((t) => t.status === tFilter);
  $('#tst-list').replaceChildren(...list.map((t) => {
    const acts = [];
    if (t.status !== 'aprovado') acts.push(el('button', { class: 'btn btn-primary', type: 'button', text: 'Aprovar', onclick: () => setTst(t, 'aprovado') }));
    if (t.status !== 'oculto') acts.push(el('button', { class: 'btn btn-outline', type: 'button', text: t.status === 'aprovado' ? 'Tirar do site' : 'Ocultar', onclick: () => setTst(t, 'oculto') }));
    const del = el('button', { class: 'btn btn-ghost adm-danger', type: 'button', text: 'Excluir' });
    del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Clique de novo'; return; }
      if (!DEMO) { const { error } = await sb.from('testimonials').delete().eq('id', t.id); if (error) { toast('Erro ao excluir.'); return; } }
      tst = tst.filter((x) => x.id !== t.id); renderTst(); toast('Depoimento excluído.');
    });
    acts.push(del);
    return el('article', { class: 'tcard' },
      el('div', { class: 'meta' }, el('span', { class: 'origin', text: t.segmento }), el('span', { text: fmtDate(t.created_at) })),
      el('blockquote', { text: `“${t.texto}”` }),
      el('div', { class: 'who' }, el('b', { text: t.nome }), ` · ${t.loja} · ${t.cidade}`),
      el('div', { class: 'acts' }, acts));
  }));
  $('#tst-empty').hidden = list.length > 0;
}
async function setTst(t, status) {
  if (!DEMO) {
    const { error } = await sb.from('testimonials').update({ status }).eq('id', t.id);
    if (error) { toast('Erro ao salvar.'); console.error(error); return; }
  }
  t.status = status; renderTst();
  toast(status === 'aprovado' ? 'Depoimento aprovado — já aparece no site.' : 'Depoimento retirado do site.');
}
document.querySelectorAll('[data-tf]').forEach((b) => b.addEventListener('click', () => {
  tFilter = b.dataset.tf;
  document.querySelectorAll('[data-tf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderTst();
}));
$('#refresh').addEventListener('click', () => loadTst());

route();
