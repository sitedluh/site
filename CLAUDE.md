# CLAUDE.md

Guia pro Claude Code neste repositório. **Sempre delegue as tarefas pros subagentes — você é o mediador que distribui o trabalho. Ao fim das tarefas sempre me dê o comando completo pra deploy ou push, sempre com o cd**

## O projeto

Site + sistema de pedidos da **D'Luh Festas** (doces e salgados pra festas). Sem build/bundler/framework: páginas HTML estáticas com CSS/JS externos, deploy por `git push`. Um único **Cloudflare Worker** (`worker-completo-pronto.js`) é o backend, falando com **Coda** (banco), **Telegram**, **InfinitePay** (pagamentos) e **Google Calendar**. Sem testes, linter ou etapa de build.

## Comandos

- **Site (`.html`/`.css`/`.js` na raiz):** sem build. Editar e `git add/commit/push` — feito pelo usuário (push de dentro do sandbox não é confiável).
- **Worker:** gitignored (credenciais hardcoded — Coda, Telegram, Google OAuth), **nunca commitar**. Deploy manual pelo usuário: `npx wrangler deploy` (config em `wrangler.jsonc` na raiz, também gitignored — name/main/compatibility_date + binding KV `WA_ESTADO`, que guarda o estado do bot WhatsApp: modo atendimento humano, espera de descrição de problema, dedup). Claude não roda isso — pede pro usuário.
- **`server.js`** (Express, proxy TTS via Google Translate): provável código morto, não referenciado nos HTMLs atuais — confirmar com o usuário antes de assumir uso.

## Arquitetura

### As 5 páginas

- **`index.html`** — landing institucional. Ticker de produtos via `GET {WORKER}/produtos`.
- **`cardapio.html`** (~190KB) — pedido do cliente final: catálogo, carrinho, frete (CEP via ViaCEP/BrasilAPI/Nominatim/OpenCage em cascata), upload de topo de bolo, envio via `POST {WORKER}/novo-pedido` (cria as linhas na tabela "Orçamentos" do Coda).
- **`empresas.html`** — clone B2B de `cardapio.html`. Lê preço/qtd das colunas `Valor Empresa`/`Quanti. Empresa` e grava `Tipo Cliente='Empresa'` no row pai. Mesmos campos do cardápio (sem CNPJ/razão social).
- **`admin.html`** — painel interno. Aba "Estoque pendente" (confirmar/cobrar entrada) + abas por status (fetch único em `carregarStatus()`). Move o pedido pelo ciclo de vida, edita itens, finaliza, apaga. **Pedido manual** (botão ➕ no header, `abrirPedidoManual()`): o atendente cria o pedido "como se fosse o cliente" — o modal monta o MESMO payload do checkout do site e envia pro `POST /novo-pedido`, então tudo se conecta sozinho (Telegram/estoque, cobrança, fila, avisos WhatsApp); grava `[pedido manual — admin]` nas Observações.
- **`painel-pedidos.html`** — painel de cozinha/entrega (modo TV/tablet). Destaque "Fazer agora" grande e central no topo (até 2 pedidos alternando a cada 10s, setas/`featNav()`), fila em grade abaixo, alertas sonoros, marcar entregue/retirado (`confirmarEntrega()`/`markDelivered()`, 3 respostas: cobrar restante / sem cobrar / **"Feito, não pago"** que grava `Pago?='Não pago'`), badge da coluna "Pago?" e campo "Valor da Entrega" da Pedidos Base, recibo em impressora térmica.

**Assets por página:** `<page>.css` + 6 JS por domínio, carregados nessa ordem (só `core` precisa vir primeiro): `<page>-core.js` (`CONFIG`, helpers como `fmtBRL`/`maskPhone`/`showToast`/`dluhNotificar`, bootstrap no `DOMContentLoaded`), `-cart.js`, `-checkout.js`, `-bot.js`, `-meus-pedidos.js`, `-auth.js`. Imagens externas na raiz: `logo.png` (conteúdo real é JPEG; favicon + logo do header), `hero.jpg` (capa). `_arquivo/` = testes fora de uso.

**Regra-mãe:** `cardapio.html` e `empresas.html` **não compartilham código** — todo CSS/JS é duplicado manualmente. Bug ou feature num só entra no outro se for replicado à mão. As únicas diferenças deliberadas no bot são o destino do link em `sbNovoPedidoFisica()`/`sbNovoPedidoEmpresa()` e o fallback `valorEmpresa`/`Mostrar Empresa` em `sbNormalizaProdutoBot()` (só em `empresas.html`).

### Front-end do cliente (em `cardapio.html` e `empresas.html`)

- **Chat Tawk.to** (`index`/`cardapio`/`empresas`): atendimento humano, bolha **escondida** por padrão (`Tawk_API.onLoad`/`onChatMinimized` → `hideWidget()`); só abre via `showWidget()`+`maximize()` de dentro do bot. `Tawk_API.customStyle` (antes do embed) posiciona desktop/mobile pra não cobrir o carrinho/FAB. Config (cor, horário) fica no dashboard do Tawk, não no código.
- **Bot de triagem (`sb*`):** FAB 📦 (`.status-bot-fab`) abre painel orientado a botões (`.sb-botoes`/`.sb-btn-opcao`). Menu (`sbMenuPrincipal()`): status do pedido, novo pedido (`sbNovoPedidoFisica()`/`sbNovoPedidoEmpresa()`), dúvidas (`sbDuvidas()`: sabores/preços/prazos), atendente (`sbAtendente()`). Campo de texto (`#status-bot-input-row`, estado `_sbEtapa`='telefone'|'data'|null, `sbInputSubmit()`) só aparece pra telefone e data. Toda folha oferece "Voltar ao menu"/"Falar com atendente" (`sbFimOpcoes()`); falha de integração cai em `sbWhatsappFallback()`; inatividade de 3min volta ao menu (`sbResetInatividade()`). Erro de registro no Coda vai direto pro WhatsApp (`_skipParaWhatsapp()`).
- **Login no bot:** só o status passa por `sbExigeLogin()` (checa `window._fbUser`, botão `sbFazerLogin()`→`window._fbSignIn()`); pedido, dúvidas e atendente não exigem (dúvidas é informação pública — o gate foi removido pra tirar fricção). `goCheckout()` já exige login, então pós-pedido o cliente já está logado. Atendente fora do horário (8h–19h) oferece "deixar mensagem no WhatsApp" em vez de beco sem saída.
- **Status ao vivo:** `GET {WORKER}/status-pedido?tel=` (últimos 8 dígitos, até 3 pedidos; retorna status, itens, total, pago, restante, `entrada`, `linkPagamento`). Traduzido pro cliente via `STATUS_BOT_EXPLICACAO` (precisa de entrada pra cada `STATUS_OPTS` **e pro intermediário `Verificando Estoque`**). No poll do acompanhamento, status desconhecido NUNCA encerra o acompanhamento — só os desfechos reais (lista `FINAIS`: Entregue/Finalizado/Cancelado) param o polling e limpam a sessão. Dúvidas leem o cache `allProducts`/`recheios` (`sbProdutosCache()`/`sbRecheiosCache()`); prazos via `GET {WORKER}/horarios-disponiveis?data=`.
- **Pós-pedido (fluxo atual, 2026-07):** ao confirmar no Coda, `_confirmarESeguirWhats()` redireciona o cliente **direto pro WhatsApp da empresa** (`irParaWhatsapp('https://wa.me/'+CONFIG.WHATSAPP)`, sem texto pré-preenchido — o bot de WhatsApp da loja assume dali). O acompanhamento no chat do site (`abrirStatusBotPosPedido()`/`sbIniciarAcompanhamento()`, descrito abaixo) segue no código mas **não é mais chamado nesse fluxo** — vale pro legado/consulta manual de status.
- **Acompanhamento pós-pedido (código mantido, fluxo aposentado):** `abrirStatusBotPosPedido()` abre o bot em tela cheia, posta o resumo (`_pedidoPendente.msg`) e dispara `sbIniciarAcompanhamento(tel,waUrl,paiId)` → polling `sbChecarStatusPedido()` a cada 12s. Rastreia por `paiId`/`idPedido` (não `pedidos[0]`, pra não pegar pedido antigo por consistência eventual; após 8 falhas de match, `_sbPollNaoAchou` volta a `pedidos[0]`). Em `Confirmado — Esperando pagamento` com `linkPagamento`, posta botões "Pagar agora" + "Pagar tudo na entrega" (`sbPagarNaEntrega()`: WhatsApp da loja com mensagem pronta identificando pedido/itens/valores); **sem link** após ~3 ciclos, avisa mesmo assim (`_sbPollSemLink`/`_sbPollAvisoSemLink`, sem marcar `_sbPollUltimoStatus`, pra mensagem do link ainda sair quando ele chegar); em `Pago — Em produção`, encerra (`sbPararAcompanhamento()`). 5 falhas seguidas → fallback WhatsApp. Sessão persiste em `localStorage` (`dluh_sb_sessao`: `sbSalvarSessao()`/`sbRestaurarSessao()`/`sbLimparSessao()`, vars `_sbPollTel`/`_sbPollPaiId`/`_sbPollUltimoStatus`; expira com 24h sem atividade via `ts`) pra sobreviver a F5/fechar aba.
- **Notificações:** `dluhNotificar()` dispara `showToast` sempre e `new Notification` quando a aba está em segundo plano (`document.hidden`/`!hasFocus()`). Usado em `mpCarregar()` e `sbAvisarNovaMensagem()` (chamada por `sbAddMsg()` com o painel fechado; marca o FAB com `.sb-unread`). Permissão pedida 1x em `sbPedirPermissaoNotificacao()`.
- **Painel "Meus Pedidos" (`mp*`):** botão + badge no header (`.header-actions`, `#mp-trigger-btn`/`#mp-trigger-badge`, `mpRenderTriggerBadge()`) abre modal (`#mp-modal-pedidos`, `mpAbrirModal()`). Aparece quando há telefone salvo (`sbTelSalvo()`); exige login Google (`mpFazerLogin()`) pra listar. Polling próprio a cada 45s (`mpInit()` via `window._onAuthChange`) em `/status-pedido`. Cards com badge (`MP_STATUS_CLS`), botões "Pagar" (`linkPagamento`), "Pagar na entrega" (`mpPagarNaEntrega()`, em `Confirmado — Esperando pagamento` mesmo sem link — WhatsApp da loja com resumo do pedido) e "Cancelar" (`MP_PODE_CANCELAR`). Transição avisa via toast (marca `dluh_mp_toast_<id>`) + selo "Atualizado" (`dluh_mp_status_<id>`, `mpMarcarVisto()`).
- **Cancelamento pelo cliente:** botão "Cancelar" → modal `#mp-modal-cancelar`, 2 etapas contra `POST {WORKER}/cancelar-pedido`: prévia (`confirmar:false`, só calcula a taxa) e confirmação (`confirmar:true`). Ver "Cancelamento e taxa escalonada".
- **Botão de envio (`.btn-wpp`):** nome é legado; não vai mais pro WhatsApp (abre o bot). Classe mantida só pelo seletor JS.

### `worker-completo-pronto.js` — o backend

Único Cloudflare Worker, roteia por `path === '/...'` num só `fetch`. **Gitignored — as credenciais (Coda API key, Telegram bot token, Google OAuth client/secret/refresh) só existem no arquivo local do usuário; nunca repetir os valores reais em commit, doc ou qualquer lugar que vá pro Git.**

Tabelas Coda (mesmo `DOC_ID`), **reconstruídas em 2026-07 adaptadas ao site** (`CODA-PLANO.md` na raiz é a spec; `GET /verificar-coda` confere o doc contra ela — colunas, Options E colunas de fórmula onde o código escreve): `TABLE_ORCAMENTOS='Pedidos%20Site'` (principal, pai+itens na mesma table), `TABLE_PEDIDOS='Fila%20Cozinha'`, `TABLE_PRODUTOS='Produtos%20Site'`, `TABLE_RECHEIOS='Recheios%20Site'`, `TABLE_LIMITES='Limites%20Site'` — referência por **NOME pré-encodado**, não grid-ID; as tables antigas (`grid-...`) ficaram no doc como arquivo histórico. **O worker é o único escritor**: as fórmulas de botão do Coda (`Adicionar`/`DEL`) foram aposentadas — `pbCriarRowFila()` cria a row da fila direto (itens sem a taxa, `Valor da Entrega`, `Pago?`, `Status='Pendente'`), `pbAtualizarFila()` reflete pagamentos (localiza por Cliente+Data+Hora) e `/apagar-pedido` deleta pai+filhas via API.

Rotas: `/produtos`, `/recheios`, `/horarios-disponiveis`, `/orcamentos`, `/novo-pedido`, `/webhook-telegram`, `/confirmar-estoque`, `/cobrar-restante`, `/gerar-cobranca`, `/entrega-confirmada`, `/webhook-pagamento`, `/criar-pedido`, `/pedidos-pendentes`, `/atualizar-status` (ao gravar `Confirmado — Esperando pagamento`, também gera a cobrança InfinitePay da entrada e grava "Link de Pagamento" se ainda não existir — cobre confirmação via admin/cozinha, não só Telegram), `/apagar-pedido`, `/upload-topper-imagem`, `/status-pedido` (inclui `entrada`/`linkPagamento` crus; os `itens` incluem as subrows "🛵 Taxa de Entrega"/"🎀 Topper"), `/editar-pedido` (POST; recria subrows e **filtra "Taxa de Entrega" da entrada** — a taxa vem separada em `taxaFrete`, senão a entrega duplica; o front filtra também em `abrirEditPedidoModal`), `/cancelar-pedido` (POST), `/cobrar-pedido-base` (GET `?rowId=` — igual `/cobrar-total` mas lê da TABLE_PEDIDOS pelo row id da API; grava `Pago?='Totalmente pago'` via webhook sufixo `_pb`; tenta gravar "Link de Pagamento" na row se a coluna existir — best-effort; responde HTML com link/copiar/WhatsApp. Fórmula: `OpenWindow("https://coda-proxy.sitedluh.workers.dev/cobrar-pedido-base?rowId=" & thisRow.Id())`), `/gerar-link-avulso` (GET `?valor=&nome=&ref=&tel=` — cobrança sem nenhuma row em nenhuma tabela; `order_nsu = ref` ou `avulso_<timestamp>`; webhook com prefixo `avulso_` só notifica Telegram sem gravar em lugar nenhum), `/cobrar-total` (GET `?rowId=` — chamado por botão-coluna do Coda via `OpenWindow()`; aceita `ID Pedido` ou row id `i-...`, cobra a coluna `Total` inteira via InfinitePay com `order_nsu` sufixo `_total`, sobrescreve "Link de Pagamento", avança pra `Confirmado — Esperando pagamento` se ainda pré-confirmação, responde página HTML com link/copiar/WhatsApp; recusa se `Valor Pago > 0` — usar Cobrar Restante. No `/webhook-pagamento`, `_total` grava `Pago?='Totalmente pago'`; pré-entrega segue fluxo da entrada → `Pago — Em produção`; já entregue → `Finalizado`), `/ranking-produtos` (GET; agrega vendas por produto nos Orçamentos em 2 janelas — `semana` últimos 7 dias com `quantidade`+`compradores` distintos por WhatsApp, `mes` últimos 30 dias com `quantidade` — base `createdAt` do pai, exclui `Cancelado` e subrows Taxa/Topper; cache em isolate 10min; consumido por `cardapio.html` pro ranking "Mais vendidos da semana" + ordenação mensal do catálogo).

Integrações: notificação Telegram (botão "Confirmar Estoque"), cobrança InfinitePay, deep link `wa.me`, evento no Google Calendar.

**Fila da cozinha (`Fila Cozinha`, `TABLE_PEDIDOS`):** o worker cria a row **direto pela API** (`pbCriarRowFila()`) no webhook da entrada (`Pago?='Só entrada'`; link `_total` → 'Totalmente pago') **e** no `/pagar-na-retirada` (`Pago?='Não pago'`) — a row nasce com os itens em texto ("N Produto" por linha, formato que o `parseItems()` do painel entende), a taxa de entrega **fora** dos itens e no campo **`Valor da Entrega`**, `Valor Total`/`Valor Pago` e `Status='Pendente'`. Pagamentos posteriores (restante, total online, Finalizado manual) passam por `pbAtualizarFila()` (localiza por Cliente+Data+Hora, mais recente primeiro). `/pedido-feito` grava `Status='Feito'`. Options exatas: `Pago?` = `Não pago`/`Só entrada`/`Totalmente pago`; `Status` = `Pendente`/`Feito`/`Entregue`. Os `PB_COL_*` (IDs da table antiga) sobrevivem só como fallback de leitura em rotas que aceitam row id de qualquer época.

**Exceção de segurança:** `admin.html`/`index.html` falam com o Coda **só via Worker**. `painel-pedidos.html` tem token Coda **hardcoded no cliente** (`CFG.token` em `painel-pedidos.js`) e fala direto com a API do Coda — desde a reconstrução, lê a table `Fila Cozinha` por **nome de coluna** (`useColumnNames=true`, sem IDs `c-...`). Falha de segurança conhecida, não corrigida — não introduzir mais segredos client-side.

### Ciclo de vida do Status (coluna "Status", tabela Orçamentos — single-select)

Os 6 valores em uso, em ordem (`STATUS_OPTS`/`STATUS_CLS` em `admin.html`):

0. `Verificando Estoque` — intermediário **fora de `STATUS_OPTS`** (gravado no Coda quando a cozinha começa a conferência, entre 1 e 2). O front conhece ele: bots (poll pré-confirmação, `STATUS_BOT_EXPLICACAO`, edição), Meus Pedidos (`MP_STATUS_CLS`/`MP_PODE_CANCELAR`/`podeEditar`) e worker (`EDITAVEIS` do `/editar-pedido`). No admin aparece como "⚠️ (antigo)" no dropdown — comportamento aceito.
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

Um de **operação** (não mexe em código):

- **`lancador-pedidos`** (`model: opus`) — lança pedidos no `admin.html` a partir de texto solto do cliente: preenche o modal de Pedido manual pelo Chrome MCP e, quando mandado, registra/confirma/cobra/marca pagar-na-retirada/entregue. Opus porque grava pedido de verdade (dinheiro envolvido). **Regra de ouro: só salva com autorização explícita** — sem ela, deixa o modal aberto pra conferência. Carrega os gotchas operacionais: a data vem sempre de `new Date()` **no navegador** (o sandbox atrasa e conversas longas atravessam dias), consistência eventual do Coda (~15s, erro na resposta não significa que falhou), `marcarEntregueAdmin()` usa `window.open()` bloqueado pelo Chrome (navegar direto em `/marcar-entregue?rowId=`), e o dicionário "o que o cliente escreve" → nome exato do produto.

Dois transversais:

- **`ux-researcher`** — pesquisa de UX/benchmark (read-only, web + contexto D'Luh); pesquisa e recomenda, não implementa.
- **`festas-specialist`** — domínio "Festas" (futura `festas.html` de orçamento de festas completas). Fonte de verdade: `FESTAS-PLANO.md` na raiz — a feature ainda não foi implementada; esse agente é quem implementa e mantém.

Três do domínio **IA de atendimento no WhatsApp** (fonte de verdade: `WHATSAPP-IA-PLANO.md` na raiz — **ainda não implementado**). São os primeiros agentes com `model:` explícito no frontmatter, escolhido pelo nível de exigência de cada um:

- **`whatsapp-ia-specialist`** (`model: opus`) — dono do plano e do serviço de IA que roda no PC ao lado da Evolution: ferramentas/tool calling, máquina de estados do pedido, guardrails de código, painel `atendimento.html`. Opus porque decide arquitetura e mexe no caminho que grava pedido de verdade (dinheiro envolvido).
- **`ia-local-infra`** (`model: sonnet`) — Ollama, modelo local, faster-whisper, Docker/Tailscale/driver, e o benchmark da Fase 0 no PC (Ryzen 5 5600GT · 16GB DDR4-3200 · GTX 1050 Ti 4GB). Sonnet porque é trabalho operacional e verificável por medição.
- **`ia-conversa-designer`** (`model: sonnet`) — persona, system prompt versionado, roteiros e os casos de teste de conversa. Sonnet porque é iteração de redação em alto volume, com risco técnico baixo (as regras que importam são travadas em código, não no prompt).

- **`ia-testador`** (`model: sonnet`) — conversa com a Bia pelo **WhatsApp Web** (Chrome MCP) como se fosse cliente, julga cada resposta contra `prompt/testes.md` e devolve relatório de defeitos já classificado por camada (prompt / guardrail / ferramenta / modelo). **Não edita nada** — só reporta. Sonnet porque o critério de aprovação está escrito; o trabalho é executar e comparar. Roda em sessão própria, e o usuário traz o relatório pro chat principal.

O bot do **site** (`bot-specialist`, funções `sb*`) e a IA do **WhatsApp** são coisas diferentes — não confundir na hora de delegar.

**Estado da implementação (2026-08-03): NO AR em produção**, fases 0–4 do plano, whitelist de um número (o dono). Existe `ia-atendimento/` (gitignored) com o serviço Node sem dependências que roda no PC (`C:\dluh\ia-atendimento`, `node index.js`, porta 8787): `index.js` (HTTP, debounce, fila, turno), `ollama.js` (tool calling), `ferramentas.js` (6 ferramentas de leitura, cache 10min), `guardrails.js` (validação de preço/produto/data em código), `historico.js` (JSON por número), `evolution.js`, `prompt/system.md` (persona "Bia", carregada em runtime), `bench/` (benchmark da Fase 0) e `SETUP.md`. No worker: constantes `IA_ATIVA=true`/`IA_URL` (Tailscale Funnel do PC na porta 8443)/`IA_KEY`/`IA_WHITELIST`/`TG_THREAD_IA=174` (tópico "IA" no grupo Dluh Pedidos), helpers `ia*` (KV `ia_pausado:<waid>` TTL 8h e `ia_global_off`), encaminhamento fire-and-forget nos dois processadores de webhook, comandos `ia off|on|reset [numero]`/`ia status` e callbacks `ia_pausar_`/`ia_retomar_` no Telegram, e as rotas `POST /ia-evento`, `GET /ia-saude` e `GET /ia-reset?tel=&token=` (devolve um número ao estado zero — pausa, **modo humano**, histórico, problema e cancelamento; existe pro `ia-testador` destravar sozinho o modo humano no meio de uma bateria). **Faltam as fases 5 (montagem de pedido), 6 (áudio/Whisper) e 7 (painel `atendimento.html`).**

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
- **`ia-atendimento/` é gitignored** (roda no PC da empresa, não é parte do site; o repo é público pelo Pages e ali vivem o system prompt, os guardrails e o `.env`). Alterações nele não vão pro `git push` — chegam no PC por cópia da pasta.
- **IA do WhatsApp:** `BOT_MENU_ATIVO` continua `false` — a IA **substitui** o menu numérico; religar os dois faz eles brigarem pela mesma mensagem. O cérebro roda no PC (não no worker), o worker encaminha em fire-and-forget com timeout, e nenhum pedido é gravado sem confirmação explícita do cliente (`[Feito por IA]` nas Observações). Detalhes em `WHATSAPP-IA-PLANO.md`.
- `cardapio.html`/`empresas.html` não compartilham código — replicar correções manualmente nos dois.
- `window._onAuthChange` é atribuído **duas vezes** (um wrapper de cima que chama o legado `initStatusBar`, sem uso real, e a atribuição final na seção "AUTH & HISTÓRICO", que é a que vale). Novos hooks de auth (ex.: `mpInit()`) vão na atribuição **final**, senão nunca executam.
- **Comparação de telefone: sempre pelo helper `telIguais()` do worker (DDD + 8 dígitos finais).** Duas armadilhas de uma vez, e aplicar só uma reintroduz a outra. **Nunca comparar inteiro e exato.** O WhatsApp entrega o número ora com o nono dígito, ora sem ele — comparação exata erra **silenciosamente** (achou o bug real da whitelist da IA em produção). Mas só os 8 finais descartam o DDD, e `55 38 98888-7777` vira igual a `55 11 98888-7777` — isso vazava pedido de um cliente pro outro em `/status-pedido` e deixava **cancelar** pedido alheio pelo bot do WhatsApp (corrigido em 2026-08-04). `telIguais()` exige o DDD quando os dois lados têm, e só cai nos 8 dígitos quando o dado gravado no Coda está sem DDD — logando `[tel] fallback sem DDD` pra dar pra medir o legado.