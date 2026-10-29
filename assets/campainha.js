/* BoraLanchar! — som de campainha de balcão ("ding-a-ling") para pedido novo.
   Gerado na hora pelo navegador (Web Audio), sem arquivo de áudio.
   Três batidas rápidas numa campainha metálica, cada uma com parciais
   inarmônicos que somem em ritmos diferentes, como um sino de verdade. */
(function () {
  // [frequência em Hz, volume relativo, tempo de queda em s]
  const PARCIAIS = [
    [1262, 0.10, 0.80],
    [3390, 0.55, 1.40],
    [6280, 1.00, 1.05],
    [9830, 0.55, 0.60],
    [13370, 0.12, 0.30],
  ];
  const BATIDAS = [[0, 0.8], [0.205, 0.75], [0.31, 1]]; // [início, força]

  function batida(ctx, out, t0, forca) {
    const desafina = 1 + (Math.random() - 0.5) * 0.004; // cada batida um pouquinho diferente
    PARCIAIS.forEach(([f, v, q]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * desafina;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v * forca, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + q * 1.6);
      o.connect(g); g.connect(out);
      o.start(t0); o.stop(t0 + q * 1.6 + 0.05);
    });
    // estalo do martelinho
    const n = Math.floor(ctx.sampleRate * 0.012), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), gs = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 4000; gs.gain.value = 0.25 * forca;
    s.buffer = buf; s.connect(hp); hp.connect(gs); gs.connect(out); s.start(t0);
  }

  window.BoraCampainha = function (ctx, volume) {
    if (!ctx) return;
    const now = ctx.currentTime + 0.02;
    const out = ctx.createGain(); out.gain.value = (volume == null ? 0.22 : volume);
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp); comp.connect(ctx.destination);
    BATIDAS.forEach(([t, f]) => batida(ctx, out, now + t, f));
  };
})();
