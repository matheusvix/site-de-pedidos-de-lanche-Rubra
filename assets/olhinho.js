/* BoraLanchar! — olhinho para mostrar/ocultar a senha em todos os campos de senha */
(() => {
  const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.8M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';
  const css = document.createElement('style');
  css.textContent = '.pw-wrap{position:relative;display:block}.pw-wrap>input{width:100%;padding-right:48px!important}'
    + '.pw-eye{position:absolute;top:50%;right:4px;transform:translateY(-50%);width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:10px;background:transparent;color:#6B5A5B;cursor:pointer;padding:0}'
    + '.pw-eye:hover{color:#1A1112;background:rgba(26,17,18,.06)}.pw-eye:focus-visible{outline:2px solid #E01E2D;outline-offset:1px}';
  document.head.appendChild(css);
  function add(input) {
    if (input.dataset.eye) return; input.dataset.eye = '1';
    const wrap = document.createElement('span'); wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-eye'; b.innerHTML = EYE;
    b.setAttribute('aria-label', 'Mostrar senha'); b.setAttribute('aria-pressed', 'false');
    if (input.id) b.setAttribute('aria-controls', input.id);
    wrap.appendChild(b);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o foco do campo
    b.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = show ? OFF : EYE;
      b.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      b.setAttribute('aria-pressed', String(show));
    });
    // volta a esconder ao enviar o formulário (o navegador só salva a senha com type=password)
    if (input.form) input.form.addEventListener('submit', () => { if (input.type === 'text') b.click(); }, true);
  }
  const run = () => document.querySelectorAll('input[type="password"]').forEach(add);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
