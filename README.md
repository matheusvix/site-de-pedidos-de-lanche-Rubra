# BoraLanchar! — cardápio digital e pedidos

Landing page do BoraLanchar!, sistema de pedidos e cardápio digital para restaurantes e delivery. Identidade vermelho e branco (logos em `assets/brand/`), site estático (HTML + CSS + JS puro, sem build).

## Funcionalidades

- Menu fixo com versão mobile (botão hambúrguer)
- **Teste grátis**: modal de cadastro com validação e máscara de WhatsApp
- **Entrar**: modal de login com "esqueci minha senha"
- **Falar com especialista**: formulário que abre o WhatsApp com a mensagem pronta (também no botão flutuante)
- Cardápio interativo no mockup do celular (troca de categoria e sacola somando itens)
- Carrossel de depoimentos com setas (e destaque no topo quando houver depoimentos aprovados)
- Faixa animada de canais e integrações
- Vídeo de demonstração narrado, tocando direto na página
- Planos com alternância mensal/anual
- FAQ em acordeão acessível
- Botão "voltar ao topo", animações ao rolar e respeito a `prefers-reduced-motion`
- Páginas de Termos e Privacidade (modelos)

- **Depoimentos com aprovação**: o botão "Conte sua experiência" envia o depoimento para o painel; só os aprovados aparecem no carrossel (enquanto não houver nenhum, o site mostra cartões marcados como "Exemplo")
- **Painel administrativo** (`admin.html`): login real, lista de leads com busca e filtros, status (novo, em contato, convertido, perdido), anotações, botão de WhatsApp por lead, exclusão e exportação CSV


## Sistema dos restaurantes

- **Cadastro**: o formulário "Teste grátis" cria a conta (e-mail e senha) e a loja com 7 dias de teste, e leva direto ao painel.
- **Painel da loja** (`painel.html` ou `/painel`): pedidos em tempo real com som, aceitar/preparo/saiu/entregue, WhatsApp do cliente com mensagem pronta, impressão do pedido; editor de cardápio (categorias, produtos, fotos, esgotado); dados da loja (taxa, pedido mínimo, entrega/retirada, abrir/fechar), link e QR Code do cardápio.
- **Cardápio de cada loja**: `/l/<link-da-loja>` (ex.: `/l/bora-burger`). O cliente monta a sacola, finaliza e acompanha o status; o pedido também pode ser enviado no WhatsApp da loja. Os preços são sempre recalculados no banco (função `place_order`).
- **Admin** (`admin.html`): leads, depoimentos e a lista de restaurantes, com "Ativar plano", "+7 dias" e "Pausar". Sem plano ativo, o cardápio pausa quando o teste acaba.

### Banco (Supabase)

Rode `supabase/instalar-tudo.sql` inteiro no SQL Editor. Depois, em Authentication:
- **Sign In / Providers → Email**: deixe "Allow new users to sign up" ligado e desligue "Confirm email".
- **URL Configuration → Site URL**: `https://boralanchar.netlify.app`.
- Para o admin: **Users → Add user** com `boralancharadm@gmail.com` e uma senha (marque "Auto Confirm User").

## Configurar o banco e o acesso admin (Supabase) — versão antiga

1. Crie uma conta grátis em [supabase.com](https://supabase.com) e um **New project** (região São Paulo).
2. Em **SQL Editor › New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**. Isso cria as tabelas, as regras de segurança e registra `boralancharadm@gmail.com` como admin.
3. Em **Authentication › Sign In / Providers**, desative **Allow new users to sign up** (só quem você convidar entra).
4. Em **Authentication › URL Configuration**, coloque em **Site URL** o endereço do site publicado + `/admin.html`
   (ex.: `https://rubra-pedidos.netlify.app/admin.html`).
5. Em **Authentication › Users › Add user › Send invitation**, convide `boralancharadm@gmail.com`. Abra o e-mail, clique no link e defina sua senha.
6. Em **Project Settings › API**, copie a **Project URL** e a **anon public key** para `assets/config.js`.

Para adicionar outro administrador: convide o e-mail em *Authentication › Users* e rode
`insert into public.admins (email) values ('outro@email.com');` no SQL Editor.

> A chave *anon* é pública por natureza. Visitantes só conseguem **inserir** leads; ler, editar e apagar é exclusivo de quem está na tabela `admins` (Row Level Security).

## Outros ajustes

Em `assets/config.js`, informe também o `whatsapp` comercial (DDI + DDD + número, só dígitos).

Depois substitua os textos entre colchetes (`[00 mil]` etc.). Os preços ficam em `data-m` / `data-a` no `index.html` (Essencial R$ 39,99, Profissional R$ 59,99, Completo R$ 79,99; teste grátis de 7 dias). O vídeo de demonstração fica em `assets/video/` (MP4 + capa) e toca direto na seção "Veja na prática".

## Rodar localmente

Basta abrir o `index.html` no navegador, ou usar:

```bash
npx serve .
```

## Publicação

Publicado na Netlify (projeto `rubra-pedidos`), configurado em `netlify.toml`.
