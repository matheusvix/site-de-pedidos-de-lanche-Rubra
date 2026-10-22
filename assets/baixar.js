/* BoraLanchar! — página de download do app (PWA instalável: Android, iPhone, Windows e Mac) */
const $ = (s) => document.querySelector(s);
const CFG = window.BORA_CONFIG || {};
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isMac = !isIOS && /Macintosh|Mac OS X/i.test(ua);
const isWin = /Windows/i.test(ua);
const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Edg\/|OPR|SamsungBrowser/i.test(ua);
const isFirefox = /Firefox|FxiOS/i.test(ua);
const OS = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
let deferred = null;

const toastEl = $('.dl-toast'); let tt;
function toast(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3600); }

// texto do botão conforme o aparelho
const LABEL = { ios: 'Baixar para iPhone', android: 'Baixar para Android', desktop: isMac ? 'Baixar para Mac' : isWin ? 'Baixar para Windows' : 'Baixar para computador' };
$('#install-txt').textContent = LABEL[OS];
document.querySelector(`.dl-card[data-os="${OS}"]`)?.classList.add('me');
$('#dl-help').href = `https://wa.me/${CFG.whatsapp || ''}?text=${encodeURIComponent('Olá! Preciso de ajuda para instalar o app BoraLanchar!.')}`;

function installed() {
  $('#install-txt').textContent = 'Abrir o app';
  $('#install-note').textContent = 'O app já está instalado neste aparelho.';
  $('#install').onclick = () => { location.href = '/painel.html?app=1'; };
}
if (standalone) installed();

// QR Code para abrir no celular (só no computador)
if (OS === 'desktop' && window.BoraQR) {
  $('#qr').innerHTML = window.BoraQR.svg(`${CFG.siteUrl || location.origin}/baixar.html`, { label: 'QR Code para baixar o app no celular', color: '#1A1112', margin: 2 });
  $('#qr-box').hidden = false;
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; toast('App instalado! Procure o ícone BoraLanchar.'); installed(); });

const STEPS = {
  ios: isSafari
    ? ['Toque em <b>Compartilhar</b> (o quadrado com a seta para cima) na barra do Safari.', 'Role e toque em <b>Adicionar à Tela de Início</b>.', 'Toque em <b>Adicionar</b>. Pronto: o ícone BoraLanchar fica na tela inicial.']
    : ['Toque em <b>Compartilhar</b> (o quadrado com a seta para cima) na barra do navegador.', 'Toque em <b>Adicionar à Tela de Início</b>.', 'Se não aparecer, abra <b>boralanchar.com.br/baixar</b> no <b>Safari</b> e repita.'],
  android: ['Toque no menu <b>⋮</b> no canto de cima do Chrome.', 'Toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).', 'Confirme em <b>Instalar</b>.'],
  desktop: isSafari
    ? ['No menu do Safari, clique em <b>Arquivo</b>.', 'Clique em <b>Adicionar ao Dock</b>.', 'Pronto: o BoraLanchar abre em janela própria pelo Dock.']
    : isFirefox
      ? ['O Firefox não instala apps de site.', 'Abra <b>boralanchar.com.br/baixar</b> no <b>Google Chrome</b> ou no <b>Microsoft Edge</b>.', 'Clique em <b>Baixar o app</b> e depois em <b>Instalar</b>.']
      : ['Na barra de endereço, clique no ícone de <b>instalar</b> (um monitor com seta, à direita).', 'Ou abra o menu <b>⋮</b> e escolha <b>Transmitir, salvar e compartilhar › Instalar página como app</b>.', 'Clique em <b>Instalar</b>. O app ganha atalho na área de trabalho.'],
};
function howTo() {
  $('#how-title').textContent = OS === 'ios' ? 'Instalar no iPhone' : OS === 'android' ? 'Instalar no Android' : 'Instalar no computador';
  $('#how-body').innerHTML = `<ol>${STEPS[OS].map((s) => `<li>${s}</li>`).join('')}</ol>`;
  $('#how').showModal();
}
$('#how').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $('#how')) $('#how').close(); });

if (!standalone) $('#install').onclick = async () => {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    if (outcome === 'accepted') { toast('Instalando… o ícone BoraLanchar vai aparecer em instantes.'); installed(); }
    return;
  }
  howTo();
};

// volta do link de confirmação do e-mail: guarda a sessão (o app já abre logado) e avisa
(function confirmacao() {
  const h = new URLSearchParams(location.hash.slice(1));
  const q = new URLSearchParams(location.search);
  if (h.get('error_description') || h.get('error')) {
    const w = $('#dl-warn'); w.hidden = false;
    w.textContent = /expired|invalid/i.test(h.get('error_code') || h.get('error_description') || '')
      ? 'Este link de confirmação expirou ou já foi usado. Instale o app e entre com seu e-mail e senha; se pedir confirmação, toque em "Reenviar e-mail".'
      : 'Não foi possível confirmar pelo link. Instale o app e entre com seu e-mail e senha.';
    history.replaceState(null, '', location.pathname);
    return;
  }
  if (h.get('access_token') || q.get('confirmado')) {
    $('#dl-ok').hidden = false;
    if (window.supabase && CFG.supabaseUrl) {
      try { window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey).auth.getSession().finally(() => history.replaceState(null, '', location.pathname + '?confirmado=1')); } catch (_) {}
    }
  }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
