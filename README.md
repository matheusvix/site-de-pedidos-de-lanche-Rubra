# Rubra — landing page modelo

Landing page de um sistema fictício de pedidos e cardápio digital para restaurantes e delivery. Identidade vermelho e branco, site estático (HTML + CSS + JS puro, sem build).

## Funcionalidades

- Menu fixo com versão mobile (botão hambúrguer)
- **Teste grátis**: modal de cadastro com validação e máscara de WhatsApp
- **Entrar**: modal de login com "esqueci minha senha"
- **Falar com especialista**: formulário que abre o WhatsApp com a mensagem pronta (também no botão flutuante)
- Cardápio interativo no mockup do celular (troca de categoria e sacola somando itens)
- Depoimentos em destaque no topo, com rotação automática, e carrossel com setas
- Faixa animada de canais e integrações
- Seção de vídeo de demonstração (abre em modal)
- Planos com alternância mensal/anual
- FAQ em acordeão acessível
- Botão "voltar ao topo", animações ao rolar e respeito a `prefers-reduced-motion`
- Páginas de Termos e Privacidade (modelos)

## Antes de usar de verdade

Abra `assets/app.js` e ajuste o bloco `CONFIG`:

| Campo | O que é |
|---|---|
| `whatsapp` | Número comercial com DDI e DDD, só dígitos (ex.: `5527999999999`) |
| `formEndpoint` | URL que recebe os cadastros em JSON (Formspree, Make, Zapier, Google Apps Script…). Vazio = só confirma na tela |
| `appUrl` | Endereço do painel para onde o login leva |

Depois substitua os textos entre colchetes (`[00 mil]`, `R$ [00]`, `[Nome do cliente]`, `[N] dias`, CNPJ etc.), troque os preços em `data-m` / `data-a` no `index.html` e coloque o embed do vídeo no modal `#video`.

## Rodar localmente

Basta abrir o `index.html` no navegador, ou usar:

```bash
npx serve .
```

## Publicação

Publicado via GitHub Pages a partir da branch `main` (pasta raiz).
