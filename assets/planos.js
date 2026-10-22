/* ============================================================
   BoraLanchar! — o que cada plano libera
   (espelha a função plan_has do banco: supabase/recursos-planos.sql)
   ============================================================ */
window.BoraPlanos = (() => {
  const ORDEM = ['Essencial', 'Profissional', 'Completo'];
  const MINIMO = { robo: 'Profissional', inbox: 'Profissional', cupons: 'Profissional', mesas: 'Completo', estoque: 'Completo', prioritario: 'Completo' };
  const NOME = {
    robo: 'Robô de atendimento no WhatsApp', inbox: 'Caixa de entrada única', cupons: 'Cupons e fidelidade',
    mesas: 'App do garçom e mesas', estoque: 'Estoque e financeiro', prioritario: 'Suporte prioritário',
  };
  const has = (plan, feat) => !MINIMO[feat] || ORDEM.indexOf(plan) >= ORDEM.indexOf(MINIMO[feat]);
  return { has, min: (feat) => MINIMO[feat] || 'Essencial', nome: (feat) => NOME[feat] || feat, ORDEM };
})();
