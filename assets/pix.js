/* BoraLanchar! — Pix "copia e cola" (BR Code, padrão EMV do Banco Central)
   O valor vai direto para a chave Pix do dono da loja. Nada passa pelo BoraLanchar!. */
window.BoraPix = (() => {
  const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
  function crc16(s) {
    let c = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      c ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return c.toString(16).toUpperCase().padStart(4, '0');
  }
  // Chave no formato que o Pix exige
  function normalizeKey(type, key) {
    const k = String(key || '').trim();
    const d = k.replace(/\D/g, '');
    if (type === 'cpf') return d.length === 11 ? d : null;
    if (type === 'cnpj') return d.length === 14 ? d : null;
    if (type === 'celular') { const n = d.replace(/^55(?=\d{10,11}$)/, ''); return n.length === 10 || n.length === 11 ? '+55' + n : null; }
    if (type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k) && k.length <= 77 ? k.toLowerCase() : null;
    if (type === 'aleatoria') return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k) ? k.toLowerCase() : null;
    return null;
  }
  function guessType(key) {
    const k = String(key || '').trim(); const d = k.replace(/\D/g, '');
    if (k.includes('@')) return 'email';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)) return 'aleatoria';
    if (/^\+/.test(k) || (d.length === 11 && /^\(?\d{2}\)?\s?9/.test(k) && !/[.]/.test(k))) return 'celular';
    if (d.length === 14) return 'cnpj';
    if (d.length === 11) return 'cpf';
    return 'celular';
  }
  /* payload({ key, name, city, amount, txid, info }) -> texto do copia e cola */
  function payload({ key, name, city, amount, txid, info }) {
    let acc = f('00', 'br.gov.bcb.pix') + f('01', key);
    const extra = plain(info).slice(0, Math.max(0, 99 - 4 - acc.length - 4));
    if (extra) acc += f('02', extra);
    const tx = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
    let p = f('00', '01')
      + f('26', acc)
      + f('52', '0000')
      + f('53', '986')
      + (amount > 0 ? f('54', Number(amount).toFixed(2)) : '')
      + f('58', 'BR')
      + f('59', plain(name).toUpperCase().slice(0, 25) || 'RECEBEDOR')
      + f('60', plain(city).toUpperCase().slice(0, 15) || 'BRASIL')
      + f('62', f('05', tx))
      + '6304';
    return p + crc16(p);
  }
  return { payload, crc16, normalizeKey, guessType, plain };
})();
