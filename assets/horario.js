/* BoraLanchar! — horário de funcionamento (mesma regra do banco, fuso de Brasília)
   opening_hours = { "0": [["18:00","23:30"]], ... }  (0 = domingo; vazio = fechado; null = sem horário definido) */
window.BoraHoras = (() => {
  const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const toMin = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const hhmm = (s) => String(s).slice(0, 5);

  function spNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { d: WD[parts.weekday] ?? new Date().getDay(), m: (+parts.hour % 24) * 60 + +parts.minute };
  }
  const list = (H, d) => ((H && H[String(d)]) || []).filter((iv) => iv && iv[0] && iv[1]);

  function openNow(R, now = spNow()) {
    if (!R.is_open) return false;
    const H = R.opening_hours; if (!H) return true;
    for (const [a, b] of list(H, now.d)) { const s = toMin(a), e = toMin(b); if (e > s ? now.m >= s && now.m < e : now.m >= s) return true; }
    for (const [a, b] of list(H, (now.d + 6) % 7)) { const s = toMin(a), e = toMin(b); if (e <= s && now.m < e) return true; }
    return false;
  }

  function status(R, now = spNow()) {
    const H = R.opening_hours;
    if (!R.is_open) return { open: false, text: 'Fechado agora' };
    if (!H) return { open: true, text: 'Aberto agora' };
    if (openNow(R, now)) {
      for (const [a, b] of list(H, now.d)) {
        const s = toMin(a), e = toMin(b);
        if (s === e) return { open: true, text: 'Aberto 24 horas' };
        if (e > s ? now.m >= s && now.m < e : now.m >= s) return { open: true, text: `Aberto · fecha às ${hhmm(b)}` };
      }
      for (const [, b] of list(H, (now.d + 6) % 7)) return { open: true, text: `Aberto · fecha às ${hhmm(b)}` };
      return { open: true, text: 'Aberto agora' };
    }
    for (let k = 0; k <= 7; k++) {
      const d = (now.d + k) % 7;
      const ivs = list(H, d).map(([a]) => toMin(a)).sort((x, y) => x - y).filter((s) => k > 0 || s > now.m);
      if (ivs.length) {
        const t = `${String(Math.floor(ivs[0] / 60)).padStart(2, '0')}:${String(ivs[0] % 60).padStart(2, '0')}`;
        const when = k === 0 ? 'hoje' : k === 1 ? 'amanhã' : CURTO[d];
        return { open: false, text: `Fechado · abre ${when} às ${t}` };
      }
    }
    return { open: false, text: 'Fechado agora' };
  }

  function fmtDay(H, d) {
    const ivs = list(H, d);
    if (!ivs.length) return 'Fechado';
    if (ivs.some(([a, b]) => toMin(a) === toMin(b))) return 'Aberto 24 horas';
    return ivs.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(', ');
  }

  return { DIAS, CURTO, spNow, openNow, status, fmtDay, toMin };
})();
