# CLAUDE.md

Guia pro Claude Code neste repositório. **Sempre delegue as tarefas pros subagentes — você é o mediador que distribui o trabalho. Ao fim das tarefas sempre me dê o comando completo pra deploy ou push, sempre com o cd**

## O projeto

Site + sistema de pedidos da **D'Luh Festas** (doces e salgados pra festas). Sem build/bundler/framework: páginas HTML estáticas com CSS/JS externos, deploy por `git push`. Um único **Cloudflare Worker** (`worker-completo-pronto.js`) é o backend, falando com **Coda** (banco), **Telegram**, **InfinitePay** (pagamentos) e **Google Calendar**. Sem testes, linter ou etapa de build.

## Comandos

- **Site (`.html`/`.css`/`.js` na raiz):** sem build. Editar e `git add/commit/push` — feito pelo usuário (push de dentro do sandbox não é confiável).
- **Worker:** gitignored (credenciais hardcoded — Coda, Telegram, Google OAuth), **nunca commitar**. Deploy manual pelo usuário: `npx wrangler deploy worker-completo-pronto.js --name coda-proxy --compatibility-date 2024-01-01`. Claude não roda isso — pede pro usuário.
- **`server.js`** (Express, proxy TTS via Google Translate): provável código morto, não referenciado nos HTMLs atuais — confirmar com o usuário antes de assumir uso.

## Arquitetura

### As 5 páginas

- **`index.html`** — landing institucional. Ticker de produtos via `GET {WORKER}/produtos`.
- **`cardapio.html`** (~190KB) — pedido do cliente final: catálogo, carrinho, frete (CEP via ViaCEP/BrasilAPI/Nominatim/OpenCage em cascata), upload de topo de bolo, envio via `POST {WORKER}/novo-pedido` (cria as linhas na tabela "Orçamentos" do Coda).
- **`empresas.html`** — clone B2B de `cardapio.html`. Lê preço/qtd das colunas `Valor Empresa`/`Quanti. Empresa` e grava `Tipo Cliente='Empresa'` no row pai. Mesmos campos do cardápio (sem CNPJ/razão social).
- **`admin.html`** — painel interno. Aba "Estoque pendente" (confirmar/cobrar entrada) + abas por status (fetch único em `carregarStatus()`). Move o pedido pelo ciclo de vida, edita itens, finaliza, apaga.
- **`painel-pedidos.html`** — painel de cozinha/entrega (modo TV/tablet). Fila do dia, alertas sonoros, marcar entregue/retirado (`confirmarEntrega()`/`markDelivered()`, com confirmação de cobrar o restante), recibo em impressora térmica.

**Assets por página:** `<page>.css` + 6 JS por domínio, carregados nessa ordem (só `core` precisa vir primeiro): `<page>-core.js` (`CONFIG`, helpers como `fmtBRL`/`maskPhone`/`showToast`/`dluhNotificar`, bootstrap no `DOMContentLoaded`), `-cart.js`, `-checkout.js`, `-bot.js`, `-meus-pedidos.js`, `-auth.js`. Imagens externas na raiz: `logo.png` (conteúdo real é JPEG; favicon + logo do header), `hero.jpg` (capa). `_arquivo/` = testes fora de uso.

**Regra-mãe:** `cardapio.html` e `empresas.html` **não compartilham código** — todo CSS/JS é duplicado manualmente. Bug ou feature num só entra no outro se for replicado à mão. As únicas diferenças deliberadas no bot são o destino do link em `sbNovoPedidoFisica()`/`sbNovoPedidoEmpresa()` e o fallback `valorEmpresa`/`Mostrar Empresa` em `sbNormalizaProdutoBot()` (só em `empresas.html`).

### Front-end do cliente (em `cardapio.html` e `empresas.html`)

- **Chat Tawk.to** (`index`/`cardapio`/`empresas`): atendimento humano, bolha **escondida** por padrão (`Tawk_API.onLoad`/`onChatMinimized` → `hideWidget()`); só abre via `showWidget()`+`maximize()` de dentro do bot. `Tawk_API.customStyle` (antes do embed) posiciona desktop/mobile pra não cobrir o carrinho/FAB. Config (cor, horário) fica no dashboard do Tawk, não no código.
- **Bot de triagem (`sb*`):** FAB 📦 (`.status-bot-fab`) abre painel orientado a botões (`.sb-botoes`/`.sb-btn-opcao`). Menu (`sbMenuPrincipal()`): status do pedido, novo pedido (`sbNovoPedidoFisica()`/`sbNovoPedidoEmpresa()`), dúvidas (`sbDuvidas()`: sabores/preços/prazos), atendente (`sbAtendente()`). Campo de texto (`#status-bot-input-row`, estado `_sbEtapa`='telefone'|'data'|null, `sbInputSubmit()`) só aparece pra telefone e data. Toda folha oferece "Voltar ao menu"/"Falar com atendente" (`sbFimOpcoes()`); falha de integração cai em `sbWhatsappFallback()`; inatividade de 3min volta ao menu (`sbResetInatividade()`). Erro de registro no Coda vai direto pro WhatsApp (`_skipParaWhatsapp()`).
- **Login no bot:** status e dúvidas passam por `sbExigeLogin()` (checa `window._fbUser`, botão `sbFazerLogin()`→`window._fbSignIn()`); pedido e atendente não exigem. `goCheckout()` já exige login, então pós-pedido o cliente já está logado.
- **Status ao vivo:** `GET {WORKER}/status-pedido?tel=` (últimos 8 dígitos, até 3 pedidos; retorna status, itens, total, pago, restante, `entrada`, `linkPagamento`). Traduzido pro cliente via `STATUS_BOT_EXPLICACAO` (precisa de entrada pra cada `STATUS_OPTS`). Dúvidas leem o cache `allProducts`/`recheios` (`sbProdutosCache()`/`sbRecheiosCache()`); prazos via `GET {WORKER}/horarios-disponiveis?data=`.
- **Acompanhamento pós-pedido:** ao confirmar, `abrirStatusBotPosPedido()` (dentro de `_confirmarESeguirWhats()`) abre o bot em tela cheia, posta o resumo (`_pedidoPendente.msg`) e dispara `sbIniciarAcompanhamento(tel,waUrl,paiId)` → polling `sbChecarStatusPedido()` a cada 12s. Rastreia por `paiId`/`idPedido` (não `pedidos[0]`, pra não pegar pedido antigo por consistência eventual; após 8 falhas de match, `_sbPollNaoAchou` volta a `pedidos[0]`). Em `Confirmado — Esperando pagamento` com `linkPagamento`, posta botão "Pagar agora"; em `Pago — Em produção`, encerra (`sbPararAcompanhamento()`). 5 falhas seguidas → fallback WhatsApp. Sessão persiste em `localStorage` (`dluh_sb_sessao`: `sbSalvarSessao()`/`sbRestaurarSessao()`/`sbLimparSessao()`, vars `_sbPollTel`/`_sbPollPaiId`/`_sbPollUltimoStatus`) pra sobreviver a F5/fechar aba.
- **Notificações:** `dluhNotificar()` dispara `showToast` sempre e `new Notification` quando a aba está em segundo plano (`document.hidden`/`!hasFocus()`). Usado em `mpCarregar()` e `sbAvisarNovaMensagem()` (chamada por `sbAddMsg()` com o painel fechado; marca o FAB com `.sb-unread`). Permissão pedida 1x em `sbPedirPermissaoNotificacao()`.
- **Painel "Meus Pedidos" (`mp*`):** botão + badge no header (`.header-actions`, `#mp-trigger-btn`/`#mp-trigger-badge`, `mpRenderTriggerBadge()`) abre modal (`#mp-modal-pedidos`, `mpAbrirModal()`). Aparece quando há telefone salvo (`sbTelSalvo()`); exige login Google (`mpFazerLogin()`) pra listar. Polling próprio a cada 45s (`mpInit()` via `window._onAuthChange`) em `/status-pedido`. Cards com badge (`MP_STATUS_CLS`), botão "Pagar" (`linkPagamento`) e "Cancelar" (`MP_PODE_CANCELAR`). Transição avisa via toast (marca `dluh_mp_toast_<id>`) + selo "Atualizado" (`dluh_mp_status_<id>`, `mpMarcarVisto()`).
- **Cancelamento pelo cliente:** botão "Cancelar" → modal `#mp-modal-cancelar`, 2 etapas contra `POST {WORKER}/cancelar-pedido`: prévia (`confirmar:false`, só calcula a taxa) e confirmação (`confirmar:true`). Ver "Cancelamento e taxa escalonada".
- **Botão de envio (`.btn-wpp`):** nome é legado; não vai mais pro WhatsApp (abre o bot). Classe mantida só pelo seletor JS.

### `worker-completo-pronto.js` — o backend

Único Cloudflare Worker, roteia por `path === '/...'` num só `fetch`. **Gitignored — as credenciais (Coda API key, Telegram bot token, Google OAuth client/secret/refresh) só existem no arquivo local do usuário; nunca repetir os valores reais em commit, doc ou qualquer lugar que vá pro Git.**

Tabelas Coda (mesmo `DOC_ID`): `TABLE_PRODUTOS`, `TABLE_PEDIDOS`, `TABLE_ORCAMENTOS` (principal), `TABLE_RECHEIOS`, `TABLE_LIMITES`.

Rotas: `/produtos`, `/recheios`, `/horarios-disponiveis`, `/orcamentos`, `/novo-pedido`, `/webhook-telegram`, `/confirmar-estoque`, `/cobrar-restante`, `/gerar-cobranca`, `/entrega-confirmada`, `/webhook-pagamento`, `/criar-pedido`, `/pedidos-pendentes`, `/atualizar-status`, `/apagar-pedido`, `/upload-topper-imagem`, `/status-pedido` (inclui `entrada`/`linkPagamento` crus), `/cancelar-pedido` (POST).

Integrações: notificação Telegram (botão "Confirmar Estoque"), cobrança InfinitePay, deep link `wa.me`, evento no Google Calendar.

**Exceção de segurança:** `admin.html`/`index.html` falam com o Coda **só via Worker**. `painel-pedidos.html` tem token Coda **hardcoded no cliente** (`CFG.token` em `painel-pedidos.js`) e fala direto com a API do Coda (só usa o Worker pra `/entrega-confirmada`). Falha de segurança conhecida, não corrigida — não introduzir mais segredos client-side.

### Ciclo de vida do Status (coluna "Status", tabela Orçamentos — single-select)

Os 6 valores em uso, em ordem (`STATUS_OPTS`/`STATUS_CLS` em `admin.html`):

1. `Aguardando confirmação` (inicial)
2. `Confirmado — Esperando pagamento` (worker grava ao confirmar estoque, via Telegram ou botão no admin)
3. `Pago — Em produção` (webhook InfinitePay confirma a entrada)
4. `Entregue — Esperando restante` (`/entrega-confirmada`, chamado pelo `painel-pedidos.html`)
5. `Finalizado` (pagamento do restante ou botão manual; nunca mais sobrescrito automaticamente)
6. `Cancelado` (`POST /cancelar-pedido`; a row **fica**, com histórico — taxa/retido/reembolso — em "Observações"; tratado como final pra bloqueio em `BLOQUEADOS`/`MP_PODE_CANCELAR` e excluído de `STATUS_FINAL`/`/pedidos-pendentes`)

Coluna secundária **"Pedido Status"** (multi-select, controle de cozinha): informativa e gatilho de auto-atualização do Status (`PEDIDO_STATUS_MAP` em `admin.html`). Vem como **array** — sempre `Array.isArray()` antes de comparar.

As Options no Coda devem bater **exatamente** com as strings que o worker escreve; valor faltando = escrita falha **silenciosamente** (vale pra `Cancelado` e qualquer novo valor de `STATUS_OPTS`).

### Cancelamento e taxa escalonada

Regra de negócio (D'Luh): o cliente cancela o próprio pedido antes da entrega, com taxa crescente perto da data (ingredientes comprados, produção iniciada). Em `calcularTaxaCancelamento(dataPedido, dataEntrega, agora, valorPago)` no worker:

- **Carência de 2 dias** desde `createdAt` (proxy, não há coluna de confirmação): sem taxa, reembolso integral.
- **Depois da carência:** taxa cresce **linear** de 0% até teto de **80%** (`TETO`) entre o fim da carência e `Data Desejada`.
- **Última hora** (≤2 dias entre pedido e entrega): qualquer cancelamento já cai no teto de 80%.
- **`Valor Pago` = 0:** taxa sempre 0%. A taxa incide sobre `Valor Pago`, não sobre a entrada-alvo nem o total.
- `POST /cancelar-pedido`: prévia (`confirmar:false` → `feePct`/`valorRetido`/`valorReembolso`, sem alterar nada) + confirmação (`confirmar:true` → grava `Cancelado` + nota em "Observações" + Telegram). Bloqueia se já `Cancelado`/`Entregue — Esperando restante`/`Finalizado`. Checa os últimos 8 dígitos do telefone vs coluna "WhatsApp". Telegram urgente (🚨) quando `feePct > 0`. Mudar o teto = só esse número no worker, front não muda.
- **Caminho separado — botão "🗑️ Apagar" do admin:** `/apagar-pedido` só dispara o botão-coluna "DEL" da tabela Orçamentos; o que acontece é 100% a fórmula **dentro do Coda** (ajustada pelo usuário), fora do nosso código. É um "cancelar apagando" interno, distinto do soft-cancel do cliente.

### Colunas extras (fluxo Empresas)

- **Produtos:** `Valor Empresa`/`Quanti. Empresa` (B2B, paralelas a `Valor`/`Quantidade mínima`; worker expõe `valorEmpresa`/`qtdMinEmpresa` com fallback pro normal). `Mostrar Empresa` (checkbox, paralela a `Mostrar`; `!== false` esconde; só afeta `empresas.html`, filtro client-side em `loadProducts()`; produtos novos nascem desmarcados/ocultos no B2B).
- **Orçamentos:** `Tipo Cliente` (single-select, precisa da Option `Empresa`) — só `empresas.html` grava; worker repassa como `tipoCliente`; `admin.html` mostra badge "🏢 Empresa".
- Coluna faltando ou renomeada no Coda = leitura/escrita falha **silenciosamente**.

## Subagentes (Claude Code)

9 subagentes ativos em `.claude/agents/`, organizados **por domínio** (não por arquivo/camada). A própria sessão principal é o **mediador**: delega automaticamente pelo campo `description` de cada um. Pra forçar um, nomeie-o na mensagem ("use o subagente cart-specialist pra...") ou use `@`. Cada subagente roda em contexto **isolado** (não vê o histórico da conversa nem os arquivos já lidos por ela, mas carrega este CLAUDE.md inteiro) e devolve só um resumo — evita floodar a conversa principal e ajuda com os arquivos grandes (`cardapio.html`/`empresas.html`).

Três cobrem arquivos que nunca foram divididos:

- **`worker-backend`** — `worker-completo-pronto.js` + integrações Coda/Telegram/InfinitePay/Calendar (carrega a regra de segurança de credenciais).
- **`admin-specialist`** — `admin.html` (carrega o gotcha `STATUS_OPTS` vs Coda).
- **`painel-pedidos-specialist`** — `painel-pedidos.html` (carrega o token hardcoded).

Quatro cruzam `cardapio.html` **e** `empresas.html`, cada um num domínio de JS duplicado (todos carregam a regra de não-compartilhamento):

- **`cart-specialist`** — catálogo/carrinho/recheios/topper/swipe (`<page>-cart.js` + `-core.js`).
- **`checkout-specialist`** — frete/CEP/horários/validação/envio (`<page>-checkout.js`).
- **`bot-specialist`** — bot de triagem + "Meus Pedidos" (`<page>-bot.js`/`-meus-pedidos.js`).
- **`auth-specialist`** — login Firebase/Google + histórico (`<page>-auth.js`).

Dois transversais:

- **`ux-researcher`** — pesquisa de UX/benchmark (read-only, web + contexto D'Luh); pesquisa e recomenda, não implementa.
- **`festas-specialist`** — domínio "Festas" (futura `festas.html` de orçamento de festas completas). Fonte de verdade: `FESTAS-PLANO.md` na raiz — a feature ainda não foi implementada; esse agente é quem implementa e mantém.

As regras dentro dos subagentes são **reforços** das deste arquivo, não fonte de verdade paralela — se uma regra mudar aqui, atualize o `.md` do subagente correspondente. **Gotcha:** editar `.claude/agents/*.md` direto no disco só vale em sessão nova (precisa reiniciar); via o comando `/agents` dentro do Claude Code, vale na hora.

**Equipe de marketing (projeto separado):** `marketing/` tem CLAUDE.md, BRAND.md e 5 subagentes próprios (estrategista, social-media, copywriter, SEO local e designer — este gera PNG/MP4 finais via templates + Chrome headless/ffmpeg) — pra usar, abra o Claude Code **direto nessa pasta**. Só produz conteúdo (nunca edita site/Coda) e está no `.gitignore` (não vai pro deploy).

## Histórico

Changelog completo em `HISTORICO.md` (raiz, **não** carregado automaticamente — abra manualmente quando precisar de contexto). Novas entradas de marco vão direto lá, no topo (mais recente primeiro), não aqui.

## Cuidados ao editar

- **Nunca** commitar `worker-completo-pronto.js` (credenciais). Mudança nele só vira produção com `wrangler deploy` manual do usuário.
- `.html`/`.css`/`.js` da raiz só viram produção depois de `git push` do usuário.
- Coluna "Pedido Status" (Coda) chega como **array** (multi-select).
- Adicionar/remover valor em `STATUS_OPTS` exige replicar a Option na coluna "Status" do Coda com o nome **exato** (senão grava silenciosamente errado) — inclui `Cancelado`.
- `painel-pedidos.html` tem token Coda hardcoded no cliente — não introduzir mais segredos client-side.
- `cardapio.html`/`empresas.html` não compartilham código — replicar correções manualmente nos dois.
- `window._onAuthChange` é atribuído **duas vezes** (um wrapper de cima que chama o legado `initStatusBar`, sem uso real, e a atribuição final na seção "AUTH & HISTÓRICO", que é a que vale). Novos hooks de auth (ex.: `mpInit()`) vão na atribuição **final**, senão nunca executam.