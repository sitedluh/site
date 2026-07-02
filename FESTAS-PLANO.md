# Plano de implementação — "Festas" (festas.html)

> Preparado em 2026-07-01. Escopo decidido: **página própria com pedido de orçamento** (não é fluxo de carrinho tipo cardápio, nem só seção institucional). Ainda **não implementado** — este documento é a fonte de verdade pra quando começar. Responsável: subagente `festas-specialist`.

## Conceito

A D'Luh também faz **festas completas** (não só doces/salgados avulsos). O cliente descreve a festa — data, nº de convidados, tipo de evento, local — e pede um **orçamento**, que cai no Coda e notifica no Telegram como os pedidos atuais. A negociação de valores acontece com atendente (Tawk/WhatsApp); o site captura o lead estruturado e dá acompanhamento de status pelo bot.

## Decisões de arquitetura (recomendadas)

### 1. Reusar a tabela Orçamentos do Coda — não criar tabela nova

Motivo: todo o encanamento existente (Telegram, `/status-pedido`, acompanhamento do bot, painel "Meus Pedidos", cancelamento com taxa, admin) já opera sobre `TABLE_ORCAMENTOS`. Uma festa vira uma row pai normal com:

- `Tipo Cliente` = nova Option **`Festa`** (⚠️ criar a Option no Coda com esse nome **exato** antes do deploy — valor faltando = escrita falha silenciosamente, mesmo gotcha do `Cancelado`).
- Colunas novas em Orçamentos: `Tipo Evento` (single-select: Aniversário, Casamento, Corporativo, Infantil, Outro), `Nº Convidados` (número), `Local Evento` (texto). Colunas faltando = escrita silenciosamente perdida — criar antes do deploy.
- Itens: os "serviços desejados" (buffet, bolo, decoração, salgados, doces...) entram como rows filhas, igual aos itens de pedido, com valor 0 até o atendente orçar.

O ciclo de vida de Status atual serve sem mudança: `Aguardando confirmação` → (atendente orça e confirma) → `Confirmado — Esperando pagamento` → `Pago — Em produção` → `Entregue — Esperando restante` → `Finalizado`, com `Cancelado` e a taxa escalonada valendo também pra festas.

### 2. Worker: reusar `/novo-pedido` com `tipoCliente:'Festa'`

Não criar rota nova. `/novo-pedido` já cria pai+filhas, notifica Telegram e devolve `paiId` (que o bot usa pro acompanhamento). Ajustes no worker:

- Aceitar e gravar os campos novos (`tipoEvento`, `numConvidados`, `localEvento`) quando `tipoCliente==='Festa'`.
- Mensagem do Telegram com cabeçalho distinto (🎉 FESTA) e os campos novos — o botão "Confirmar Estoque" vira na prática "Confirmar orçamento enviado".
- `/status-pedido` não muda (já devolve por telefone).
- ⚠️ Worker é gitignored (credenciais) — mudança só vira produção com `wrangler deploy` manual do usuário.

### 3. Página: `festas.html` LEVE — não clonar cardapio.html

**Não repetir o erro da duplicação tripla.** A página é um formulário de orçamento + vitrine institucional (fotos de festas), não um catálogo com carrinho. Arquivos:

- `festas.html` + `festas.css` — layout próprio, reaproveitando visual do index (hero, paleta).
- `festas-core.js` — `CONFIG`, `fmtBRL`, `maskPhone`, `showToast`, `dluhNotificar` (copiar de `cardapio-core.js`).
- `festas-form.js` — o formulário: tipo de evento, data (validar contra `GET /horarios-disponiveis?data=`), nº convidados, CEP/local (cascata ViaCEP/BrasilAPI já existente no checkout — copiar só a parte de CEP, sem frete), serviços desejados (checkboxes), observações, telefone. Envia via `POST /novo-pedido` com `tipoCliente:'Festa'`.
- `festas-bot.js` + `festas-meus-pedidos.js` + `festas-auth.js` — copiar dos equivalentes de `cardapio`, trocando só o contexto de `sbNovoPedido()` (oferecer "🎉 Orçamento de festa aqui | 🍰 Doces e salgados no cardápio"). ⚠️ Isso **estende a regra-mãe da duplicação pra 3 páginas** nesses domínios — toda correção em bot/meus-pedidos/auth passa a ser replicada em TRÊS arquivos. Custo aceito conscientemente; alternativa (compartilhar JS) foi rejeitada pelo padrão do projeto.
- Login: mesmo padrão — envio do orçamento exige login Google (reusar `goCheckout()`-like gate), status/dúvidas via `sbExigeLogin()`.

### 4. Pontos de entrada

- `index.html`: nova seção "Festas completas" com CTA pra `festas.html` (+ item no menu).
- `cardapio.html` e `empresas.html`: em `sbNovoPedido()`/`sbNovoPedidoEmpresa()`, adicionar botão "🎉 Quero uma festa completa" → `festas.html` (replicar manualmente nos dois, regra-mãe).
- `admin.html`: badge "🎉 Festa" quando `tipoCliente==='Festa'` (igual ao "🏢 Empresa") + exibir os campos novos no detalhe do pedido.
- `painel-pedidos.html`: festas aparecem na fila do dia normalmente (são pedidos com `Data Desejada`); avaliar filtro/ícone distinto.

## Ordem de implementação sugerida

1. **Coda primeiro** (usuário, manual): Option `Festa` em `Tipo Cliente` + colunas `Tipo Evento`/`Nº Convidados`/`Local Evento`. Nada funciona sem isso e a falha é silenciosa.
2. Worker: campos novos + Telegram 🎉 (deploy manual do usuário).
3. `festas.html`/`festas.css`/`festas-core.js`/`festas-form.js` (página funcional mínima).
4. Bot/meus-pedidos/auth da página (cópia adaptada).
5. Entradas: index, bots do cardapio/empresas, admin badge.
6. Teste ponta a ponta: orçamento → Telegram → confirmar → link de pagamento → status no bot.

## Gotchas herdados que valem aqui

- Options/colunas do Coda com nome **exato** ou a escrita falha silenciosamente.
- "Pedido Status" chega como **array** — `Array.isArray()` antes de comparar.
- Nenhum segredo client-side novo (o token do painel-pedidos é dívida conhecida, não precedente).
- Worker nunca commitado.
- `window._onAuthChange`: hooks novos vão na atribuição **final** (gotcha do arquivo de auth).
