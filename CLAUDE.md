# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

Site + sistema de pedidos da **D'Luh Festas** (doces e salgados para festas). Não é um projeto com build/bundler/framework — são páginas HTML estáticas (com JS inline) hospedadas via Git (deploy = `git push`), mais um Cloudflare Worker que funciona como backend único, falando com Coda (banco de dados), Telegram, InfinitePay (pagamentos) e Google Calendar.

Não há testes automatizados, linter, nem etapa de build neste repositório.

## Comandos

**Site (arquivos .html na raiz):** não tem build. Editar o arquivo e o deploy é:
```
git add <arquivo.html>
git commit -m "..."
git push
```
Isso é tudo — não existe servidor de build, é puro HTML/CSS/JS estático.

**Worker (`worker-completo-pronto.js`):** este arquivo é gitignored (contém API keys hardcoded — Coda, Telegram, Google OAuth) e **nunca deve ser commitado**. Deploy é manual, direto do terminal do usuário:
```
npx wrangler deploy worker-completo-pronto.js --name coda-proxy --compatibility-date 2024-01-01
```
Qualquer mudança no worker só entra em produção depois desse comando ser executado (Claude não tem como rodá-lo — pede pro usuário rodar).

**`server.js`** (Express + `package.json`, `npm start`): proxy de TTS via Google Translate. Não está referenciado em nenhum dos arquivos HTML atuais (`painel-pedidos.html` usa a Web Speech API nativa do navegador para voz). Parece código morto/legado — confirmar com o usuário antes de assumir que está em uso.

## Arquitetura

### As 5 páginas e pra que cada uma serve

- **`index.html`** — landing page institucional. Carrega um "ticker" de produtos via `GET {WORKER}/produtos`. Link para `cardapio.html`.

**Chat Tawk.to:** `index.html`, `cardapio.html` e `empresas.html` carregam o widget de chat ao vivo do Tawk.to (script antes de `</body>`, mesma property em todas as três). `admin.html` e `painel-pedidos.html` não têm o widget — são ferramentas internas, não páginas de cliente. Conversas e configuração (cor, posição, horário) ficam no dashboard do Tawk.to, não no código. Em `cardapio.html` e `empresas.html` (as duas páginas com botão "Meu Carrinho"), há um `Tawk_API.customStyle={visibility:{mobile:{...}}}` declarado **antes** do script de embed pra subir o widget no mobile e evitar que ele fique em cima do botão do carrinho — se o offset (`yOffset:90`) precisar de ajuste fino, é só mudar esse valor (precisa continuar antes do embed pra ter efeito). A bolha própria do Tawk fica **escondida** (`Tawk_API.onLoad`/`onChatMinimized` chamam `hideWidget()`) — o único botão de chat visível na tela é o bot de status (📦); o Tawk só aparece quando acionado de dentro do bot (ver próximo parágrafo), unificando os dois chats num único ponto de entrada visual.

**Bot de triagem D'Luh (chat próprio, separado do Tawk):** em `cardapio.html` e `empresas.html`, o painel de chat próprio (FAB 📦 fixo no canto **inferior direito**, empilhado *acima* do widget do Tawk e do botão "Meu Carrinho" — mesmo lado da tela que os dois, só mais alto: `bottom:170px` contra o `yOffset:90` do Tawk e o `bottom:24px` do carrinho; no breakpoint mobile `max-width:480px` os três valores encolhem proporcionalmente, ver `.status-bot-fab`/`.status-bot-panel` no CSS) deixou de ser só uma consulta de status e virou um bot de triagem completo, **orientado a botões** (`.sb-botoes`/`.sb-btn-opcao`) em vez de texto livre — o campo de texto (`#status-bot-input-row`, escondido por padrão via classe `sb-hide`) só aparece nos dois pontos que realmente precisam de digitação: telefone (status do pedido) e data (prazos/disponibilidade), controlados pela variável de estado `_sbEtapa` (`'telefone'`|`'data'`|`null`) e despachados por `sbInputSubmit()`.

Fluxo (espelha `sbMenuPrincipal()` em diante no HTML): o menu principal oferece 4 opções — `sbStatusPedirTelefone()` (status do pedido), `sbNovoPedido()` (novo pedido — física fica na própria página, empresa abre a outra), `sbDuvidas()` (submenu: sabores/recheios, preços, prazos/datas, outra) e `sbAtendente()` (atendente humano). Cada opção clicada é registrada via `POST {WORKER}/bot-intencao` (fire-and-forget, `sbRegistrarIntencao()`) — notifica o Telegram do time sobre o que o cliente está buscando, mesmo que ele abandone o chat sem concluir. Toda folha do fluxo termina oferecendo "🔁 Voltar ao menu" e "💬 Falar com atendente" (helper `sbFimOpcoes()`), e qualquer falha de integração (Coda, Tawk, status) cai num fallback de WhatsApp com botão clicável (`sbWhatsappFallback()` — usa um botão em vez de `window.open()` direto porque o disparo normalmente vem depois de um `await` malsucedido, e nesse ponto não é mais um gesto síncrono do usuário, então o navegador pode bloquear um popup automático). Se o telefone do pedido já é conhecido (pedido recente ou salvo no `localStorage`), o bot confirma em vez de pedir de novo (`sbStatusPedirTelefone()`). Depois de 3 minutos sem interação, o bot pergunta "Ainda por aí?" e volta ao menu (`sbResetInatividade()`).

Status do pedido consulta **ao vivo** no Coda via `GET {WORKER}/status-pedido?tel=...` (rota só leitura). A rota busca pelos últimos 8 dígitos do telefone (mesmo critério de normalização do `/entrega-confirmada`) e retorna até 3 pedidos mais recentes daquele número, com status, itens, total, valor pago e restante; mensagens de status são traduzidas pro cliente via o mapa `STATUS_BOT_EXPLICACAO` no HTML (precisa ter uma entrada pra cada valor de `STATUS_OPTS`, senão mostra só o status crú sem explicação). Dúvidas de sabores/preços leem do cache `allProducts`/`recheios` já carregado pelo `loadProducts()` da página (sem nova chamada de rede no caso comum); só faz fetch direto a `/produtos`/`/recheios` se o cache ainda estiver vazio (`sbProdutosCache()`/`sbRecheiosCache()` — em `empresas.html` essas funções já aplicam o mesmo fallback `valorEmpresa`/`qtdMinEmpresa`/`Mostrar Empresa` que `loadProducts()` usa, pra não mostrar preço de pessoa física no bot do site B2B). Dúvida de prazos pede uma data (dd/mm/aaaa) e consulta `GET {WORKER}/horarios-disponiveis?data=...` pra dizer se ainda há horário livre naquele dia.

Quando aberto logo após um pedido (`abrirStatusBotPosPedido`, que substitui o antigo `irParaWhatsapp(p.waUrl)` dentro de `_confirmarESeguirWhats()`), o painel abre em **tela cheia** (`abrirStatusBot(msg, true)` adiciona a classe `.fullscreen`) já com a mensagem "Aguardando confirmação" e pula direto pras opções de saída (não repete o menu, já que o contexto é óbvio); quando reaberto manualmente pelo FAB sem essa mensagem (`abrirStatusBot()` sem argumentos), mostra o menu principal completo. Um botão "Falar com atendente" (sempre visível no rodapé do painel, além de aparecer dentro do próprio fluxo) chama `Tawk_API.showWidget()` + `Tawk_API.maximize()` pra abrir o chat humano do Tawk — como a bolha do Tawk fica escondida por padrão (ver parágrafo anterior), esse é o único jeito de chegar no atendimento humano. O fluxo de erro (`_skipParaWhatsapp()`, usado quando o registro no Coda falha) continua indo direto pro WhatsApp sem mudança — nesse caso não existe pedido salvo no Coda pro bot consultar. Como sempre, `cardapio.html` e `empresas.html` não compartilham código — o painel/CSS/JS do bot foi duplicado manualmente nos dois arquivos, com as únicas diferenças sendo o destino do link física↔empresa em `sbNovoPedidoFisica()`/`sbNovoPedidoEmpresa()` e o fallback `valorEmpresa`/`Mostrar Empresa` em `sbNormalizaProdutoBot()` (só em `empresas.html`).

**Botão de envio do pedido (`.btn-wpp`):** apesar do nome da classe (legado), o botão final de "Enviar Pedido" não menciona mais WhatsApp — nem no texto nem no ícone (ícone trocado do logo do WhatsApp pra um ícone de "enviar"/paper-plane genérico, cor trocada de `#25D366` pra `var(--accent)`). Isso porque o fluxo pós-pedido não vai mais pro WhatsApp por padrão (abre o bot de status, ver acima); a classe `.btn-wpp` continua com esse nome só por compatibilidade com o seletor `document.querySelector('.btn-wpp')` usado no JS de envio — não tem efeito visual, é só identificação interna.
- **`cardapio.html`** (arquivo grande, ~770KB) — formulário de pedido do cliente final: catálogo, carrinho, cálculo de frete (usa CEP via ViaCEP/BrasilAPI/Nominatim/OpenCage como fallbacks em cascata), upload de foto de topo de bolo, e envio do pedido via `POST {WORKER}/novo-pedido`. É quem cria as linhas na tabela "Orçamentos" do Coda.
- **`empresas.html`** — clone de `cardapio.html` para pedidos B2B (empresas que compram em volume). Mesmos campos/fluxo do cardápio normal, mas: lê preço e quantidade mínima das colunas `Valor Empresa`/`Quanti. Empresa` da tabela Produtos (em vez de `Valor`/`Quantidade mínima`; o worker já manda os dois pares em `/produtos`, com fallback pro valor normal se a coluna empresa estiver vazia num produto) e grava `{column:'Tipo Cliente', value:'Empresa'}` no row pai do pedido, pra diferenciar no Coda/admin. Mantém os mesmos campos de formulário do cardápio normal (sem CNPJ/razão social). Precisa ser mantido manualmente em paralelo ao `cardapio.html` — não há componente compartilhado entre os dois arquivos.
- **`admin.html`** — painel administrativo (uso interno). Duas áreas principais: aba "Estoque pendente" (confirmar/cobrar entrada de pedidos novos) e abas de "Status" (uma aba por status do pedido, todas alimentadas por um único fetch em `carregarStatus()`). É aqui que a equipe move o pedido pelo ciclo de vida (status), edita itens, finaliza, ou apaga.
- **`painel-pedidos.html`** — painel de cozinha/entrega (tela própria, modo TV/tablet). Mostra a fila do dia, alertas sonoros por proximidade do horário, e o botão de marcar pedido como entregue/retirado (que agora abre uma caixa de confirmação perguntando se deve cobrar o restante antes de fazer qualquer alteração — ver `confirmarEntrega()`/`markDelivered()`). Também imprime recibo em impressora térmica.

**`_arquivo/`** — pasta de arquivos de teste/debug, **fora de uso**, não fazem parte do fluxo real do site (mantidos só de referência, caso seja preciso depurar algo específico):
- `teste-frete.html` — teste isolado do cálculo de frete.
- `teste-gerar-cobranca.html` — teste do endpoint `/gerar-cobranca` do worker.
- `teste-webhook.html` — teste do endpoint `/webhook-pagamento` do worker.

**Diferença importante:** `admin.html` e `index.html` falam com o Coda **só através do Worker**. `painel-pedidos.html` é a exceção — ele tem um token do Coda hardcoded no próprio JS do cliente (`CFG.token`) e fala direto com a API do Coda pra ler/escrever na tabela "Pedidos Base", só passando pelo Worker no passo de gerar a cobrança do restante (`/entrega-confirmada`). Isso é uma falha de segurança conhecida (token exposto no código-fonte da página) — não foi corrigida ainda, só está documentada aqui.

### `worker-completo-pronto.js` — o backend

Um único Cloudflare Worker que centraliza tudo. Arquivo gitignored — **as credenciais abaixo existem só no arquivo local do usuário, nunca repita os valores reais em commits, documentação ou em qualquer lugar que vá pro Git**: API key do Coda, token do bot do Telegram, OAuth client/secret/refresh token do Google.

IDs de tabela do Coda usados pelo worker (mesmo doc, `DOC_ID`):
- `TABLE_PRODUTOS`, `TABLE_PEDIDOS`, `TABLE_ORCAMENTOS` (a principal — pedidos/orçamentos), `TABLE_RECHEIOS`, `TABLE_LIMITES`.

Principais rotas (todas roteadas por `path === '/...'` dentro de um único `fetch` handler):
`/produtos`, `/recheios`, `/horarios-disponiveis`, `/orcamentos`, `/novo-pedido`, `/webhook-telegram`, `/confirmar-estoque`, `/cobrar-restante`, `/gerar-cobranca`, `/entrega-confirmada`, `/webhook-pagamento`, `/criar-pedido`, `/pedidos-pendentes`, `/atualizar-status`, `/apagar-pedido`, `/upload-topper-imagem`, `/status-pedido`, `/bot-intencao`.

Integrações disparadas pelo worker: notificação no Telegram (com botão "Confirmar Estoque"), link de cobrança InfinitePay, mensagem de WhatsApp (deep link `wa.me`), criação de evento no Google Calendar.

### Ciclo de vida do Status (coluna "Status" da tabela Orçamentos no Coda)

Single-select. Os **5 valores realmente em uso hoje**, em ordem (ver `STATUS_OPTS`/`STATUS_CLS` em `admin.html`):
1. `Aguardando confirmação` (padrão/inicial)
2. `Confirmado — Esperando pagamento` (worker grava ao confirmar estoque, via Telegram ou botão no admin)
3. `Pago — Em produção` (worker grava quando o webhook do InfinitePay confirma a entrada)
4. `Entregue — Esperando restante` (worker grava via `/entrega-confirmada`, chamado pelo `painel-pedidos.html`)
5. `Finalizado` (worker grava ao confirmar pagamento do restante, ou manualmente pelo botão "Finalizar" no admin — uma vez `Finalizado`, nunca mais é sobrescrito automaticamente)

Existe uma segunda coluna, **"Pedido Status"** (multi-select, controle de cozinha — ex. "Em Produção", "Entregue"), que é só informativa e serve de gatilho para auto-atualizar o Status principal (`PEDIDO_STATUS_MAP` em `admin.html`). Por ser multi-select, a API do Coda retorna essa coluna como **array**, não string — sempre tratar com `Array.isArray(...)` antes de comparar.

As Options da coluna "Status" no Coda devem corresponder exatamente às strings literais que o worker escreve — se o admin adiciona/remove um valor de `STATUS_OPTS`, o Coda precisa ter exatamente essa Option cadastrada, senão a escrita falha silenciosamente.

### Colunas extras pro fluxo de Empresas

- Tabela **Produtos**: colunas `Valor Empresa` (preço unitário B2B) e `Quanti. Empresa` (quantidade mínima B2B), paralelas a `Valor`/`Quantidade mínima`. O worker (`/produtos`) lê as duas e expõe `valorEmpresa`/`qtdMinEmpresa` na resposta, com fallback pro valor normal quando a coluna empresa está vazia num produto — então é seguro deixar produtos sem preço B2B definido ainda.
- Tabela **Produtos**: coluna `Mostrar Empresa` (checkbox), paralela a `Mostrar`. Mesma semântica (`!== false` esconde o produto), mas só afeta o catálogo de `empresas.html` — `Mostrar` continua controlando `cardapio.html`/`index.html` normalmente, sem mudança. O worker (`/produtos`) expõe `mostrarEmpresa` na resposta; o filtro acontece client-side em `empresas.html` (`loadProducts()`), em cima do array que já passou pelo filtro de `Mostrar`. Por ser coluna nova, produtos existentes nascem **desmarcados** — ficam ocultos no site de empresas até alguém marcar manualmente os que devem aparecer lá.
- Tabela **Orçamentos**: coluna `Tipo Cliente` (single-select, precisa ter a Option `Empresa` cadastrada) — `empresas.html` grava esse valor no row pai a cada pedido; `cardapio.html` não grava nada nela (fica em branco = cliente pessoa física). O worker (`/pedidos-pendentes`) repassa esse campo como `tipoCliente`, e `admin.html` mostra um badge "🏢 Empresa" no card quando esse valor é `'Empresa'`.
- Se essas colunas não existirem no Coda com esses nomes exatos, a leitura/escrita falha silenciosamente (mesmo padrão de risco já documentado pra `STATUS_OPTS`).

## Histórico do projeto (principais marcos, mais recentes primeiro)

- Bot de triagem completo: o antigo bot de consulta de status (só telefone) virou um fluxo de menu orientado a botões — status do pedido, novo pedido (física/empresa), dúvidas (sabores/recheios, preços, prazos/datas) e atendente — em `cardapio.html`/`empresas.html`. Respostas de dúvidas reaproveitam o cache de produtos/recheios já carregado pela página (com preço B2B correto em `empresas.html`); timeout de inatividade (3 min) volta ao menu; toda escolha do menu é registrada no Telegram via nova rota do worker `/bot-intencao`, pra relatório de intenção mesmo quando o cliente abandona o chat; falhas de integração caem num botão de fallback pro WhatsApp (em vez de `window.open()` automático, que o navegador bloquearia fora de um clique síncrono).
- Unificação dos chats: a bolha própria do Tawk fica escondida (`hideWidget()`); só o bot de status (📦) aparece na tela, e "Falar com atendente" dentro dele abre o Tawk sob demanda. Painel do bot abre em tela cheia quando acionado logo após o pedido. Botão final de envio ("Enviar Pedido") perdeu o texto/ícone/cor de WhatsApp.
- Bot de Status do Pedido: substitui o redirect pós-pedido pro WhatsApp por um chat próprio (separado do widget do Tawk) em `cardapio.html`/`empresas.html`, que explica a situação inicial e permite consultar o status real do pedido a qualquer momento (worker `/status-pedido`, nova rota de leitura por telefone).
- Coluna `Mostrar Empresa` (Produtos): permite ocultar/exibir produtos especificamente no catálogo de `empresas.html`, independente de `Mostrar`. Worker (`/produtos`) e `empresas.html` (`loadProducts()`) atualizados.
- `empresas.html` (novo): cardápio B2B clonado de `cardapio.html`, com preço/quantidade mínima vindos de `Valor Empresa`/`Quanti. Empresa` e tag `Tipo Cliente=Empresa` no pedido. Worker (`/produtos`, `/pedidos-pendentes`) e `admin.html` (badge "🏢 Empresa") atualizados em conjunto.
- Caixa de confirmação no `painel-pedidos.html` antes de marcar entregue/cobrar restante (gate: nenhuma alteração — Coda, worker, WhatsApp — ocorre antes da resposta do usuário).
- `admin.html`: dados do pedido (telefone/data/hora/tipo) mais evidentes visualmente; data exibida em dd/mm/aaaa.
- `admin.html`: layout full-width (página inteira, não só a barra de abas), correção do bug de "Pedido Status" como array (multi-select) e dropdown de status que enganava ao mostrar status legado/desconhecido.
- Reestruturação da aba "Status" do admin em N abas de nível superior (uma por status), todas usando o mesmo fetch (`carregarStatus()`).
- Deep-link do Telegram pro admin via `?rowId=` (clica no link da notificação do Telegram e cai direto no pedido certo dentro do admin).
- Botão "Apagar" (🗑️) no admin, ligado ao botão "DEL" do Coda via `/apagar-pedido`.
- Topper (imagem do topo do bolo) tratado como item filho, com foto enviada pro Google Drive e referenciada no Coda/Telegram/admin.
- Cobrança do restante e da entrada passou a usar as colunas "Valor Total"/"Valor Pago" pelo **nome** da coluna (não pelo ID), por confiabilidade.
- Horário de atendimento (8h–19h) e bloqueio de pedidos no domingo, no `cardapio.html`.
- Base original: site institucional + cardápio + checkout com frete por CEP + admin de pedidos + painel de cozinha com alertas sonoros e impressão térmica + automações via Telegram/InfinitePay/Google Calendar no worker.

## Cuidados ao editar

- **Nunca** commitar `worker-completo-pronto.js` (está no `.gitignore` por conter credenciais). Mudanças nele só viram produção quando o usuário roda o `wrangler deploy` manualmente.
- Mudanças nos `.html` da raiz só viram produção depois de `git push` — feito pelo próprio usuário (o commit/push não costuma ser feito de dentro do sandbox de forma confiável).
- Ao tocar na coluna "Pedido Status" (Coda), lembrar que ela chega como array (multi-select).
- Ao adicionar/remover um valor em `STATUS_OPTS` (`admin.html`), replicar a mudança nas Options da coluna "Status" no Coda.
- `painel-pedidos.html` tem um token do Coda hardcoded no cliente — risco de segurança conhecido, não introduzir mais segredos client-side do que já existe.
- `empresas.html` e `cardapio.html` não compartilham código (cada um é um arquivo HTML independente) — uma correção de bug ou feature nova num (ex.: cálculo de frete, upload de topper) só entra no outro se for replicada manualmente.
