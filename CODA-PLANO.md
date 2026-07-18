# Reconstrução do Coda — adaptado ao site

> O doc atual foi criado antes do site e não conversa bem com ele. Este plano inverte a lógica: **o site define o schema** — as tables novas têm exatamente as colunas que o código lê/escreve (nomes idênticos aos usados no código), nada além. Decisões já tomadas: manter a arquitetura de 2 tables de pedido (principal + fila da cozinha), tables novas **no mesmo doc**, começando **vazias** (dados antigos ficam nas tables velhas como arquivo; o usuário passa o que quiser depois).

## Princípios

1. **Worker é o único escritor** nas tables de pedido. As fórmulas de botão do Coda (`Adicionar`, `DEL`) morrem — o worker cria a row da fila diretamente (com `Valor da Entrega` e `Pago?` já certos, sem pós-processamento) e apaga pedidos via API.
2. **Nomes de coluna = os que o código já usa.** Renomear coluna no Coda = quebra silenciosa; então o nome exato abaixo é contrato. A rota nova `GET /verificar-coda` confere tudo e aponta o que falta.
3. **Referência por NOME** (tables e colunas) em todo o código migrado — some o problema de IDs `grid-`/`c-` órfãos.
4. Toda coluna select tem **todas** as Options que o código escreve, com o texto exato (acentos incluídos).

## As 5 tables novas (criar no doc atual, à mão — a API do Coda não cria tables)

### 1. `Pedidos Site` (substitui Orçamentos — pai + itens na mesma table, como hoje)

Rows PAI (pedido) — colunas:

| Coluna | Tipo | Observação |
|---|---|---|
| `Cliente` | Texto | |
| `WhatsApp` | Texto | busca sempre pelos últimos 8 dígitos |
| `Total` | Número (moeda) | |
| `Entrega` | Select: `Entrega em endereço`, `Retirada no local` | textos exatos que o checkout envia |
| `Endereço` | Texto | |
| `Pagamento` | Texto | forma de pagamento escolhida no checkout |
| `Data Desejada` | Data | |
| `Hora` | Hora | |
| `Observações` | Texto (multiline) | worker concatena notas (cancelamento, pagar na retirada) |
| `Entrada` | Número (moeda) | |
| `Restante` | Número (moeda) | |
| `Valor Pago` | Número (moeda) | webhook grava |
| `Status` | Select com **7 Options exatas**: `Aguardando confirmação`, `Verificando Estoque`, `Confirmado — Esperando pagamento`, `Pago — Em produção`, `Entregue — Esperando restante`, `Finalizado`, `Cancelado` | o travessão é "—" (em-dash), não hífen |
| `Pedido Status` | Multi-select: `Entregue` (+ o que a cozinha quiser) | gatilho do auto-update no admin |
| `Tipo Cliente` | Select: `Empresa`, `Festa` | vazio = pessoa física |
| `ID Pedido` | Fórmula: `Format("PED-{1}", RowId(thisRow))` | identificador estável usado por webhook/bot |
| `Comprovante` | Texto/Link | |
| `Link de Pagamento` | Texto/Link | |
| `Telegram Msg ID` | Texto | `chatId:messageId` da notificação original no tópico Pendentes — usada por `sincronizarBotaoTelegram()` pra editar essa mensagem (trocar o botão "Confirmar Estoque") quando o pedido é confirmado por fora do Telegram (admin/Coda). Sem essa coluna, a escrita/leitura falha silenciosa e a mensagem original nunca é atualizada. |

Rows ITEM (mesma table) — colunas adicionais:

| Coluna | Tipo | Observação |
|---|---|---|
| `Pedido` | Relation → `Pedidos Site` | aponta pro pai; pai tem `Produto` vazio (convenção mantida) |
| `Produto` | Texto | |
| `Row ID Produto` | Texto | |
| `Quantidade` | Número | |
| `Valor Unit` | Número (moeda) | |
| `Valor Item` | Fórmula: `thisRow.Quantidade * thisRow.[Valor Unit]` | |
| `Recheios` | Texto | |
| `Topo Info` | Texto (multiline) | topper personalizado |
| `Referencia` | Texto/Link | foto de referência do topper (Drive) |

### 2. `Fila Cozinha` (substitui Pedidos Base — 1 row por pedido, SEM filhas)

| Coluna | Tipo | Observação |
|---|---|---|
| `Cliente` | Texto | |
| `Telefone` | Texto | |
| `Data` | Data | usada por `/horarios-disponiveis` |
| `Hora` | Hora | idem |
| `Tipo` | Select: `Entrega`, `Retirada` | |
| `Pedido` | Texto (multiline) | itens no formato "2 Coxinha" por linha (o painel parseia assim) |
| `Quantidade de Itens` | Número | usada no limite de agenda |
| `Valor Total` | Número (moeda) | |
| `Valor Pago` | Número (moeda) | |
| `Valor da Entrega` | Número (moeda) | **campo do pai — não existe mais row filha de taxa** |
| `Pago?` | Select: `Não pago`, `Só entrada`, `Totalmente pago` | |
| `Status` | Select: `Pendente`, `Feito`, `Entregue` | o worker (`/pedido-feito`) grava `Feito`; `Entregue` é desfecho legado que o painel também reconhece |

O worker cria a row da fila diretamente em 2 momentos: entrada paga (webhook, `Pago?='Só entrada'`) e "Pagar na Retirada" (`Pago?='Não pago'`) — já com `Valor da Entrega` preenchido e a taxa FORA do texto/valor dos itens.

### 3. `Produtos Site`

`Produto` (texto), `Ingredientes` (texto), `Valor` (moeda), `Quantidade mínima` (número), `Tipo` (select: os tipos do cardápio — Bolos, Doces, Salgados, Pacote Congelado, Outros...), `Imagem` (imagem), `Mostrar` (checkbox), `Popular` (checkbox), `Valor Empresa` (moeda), `Quanti. Empresa` (número), `Mostrar Empresa` (checkbox), `Tipos (Pacotes)` (texto ou seleção múltipla — **não é uma lista literal de opções**: é um filtro de categoria. Cada valor cadastrado é uma categoria que deve bater com o campo `Tipo` de OUTROS produtos do catálogo — ex.: se `Tipos (Pacotes)` de um "Pacote Congelado" tem "Salgado Frito", e existem produtos "Coxinha"/"Provolone" com `Tipo`="Salgado Frito", o site resolve as opções do pacote pra "Coxinha"/"Provolone" (não mostra o texto "Salgado Frito"). `GET /produtos` devolve a coluna crua como `tiposPacote` (array de strings — as categorias, aceitando array ou texto separado por vírgula/ponto-e-vírgula/quebra de linha); a resolução categoria→nomes de produto acontece no front (`opcoesPacote(p)` em `<page>-cart.js`, cruza `tiposPacote` do pacote com o `tipo` de cada item de `allProducts`). Produto sem essa coluna preenchida, ou sem nenhum produto do catálogo com `Tipo` correspondente, não abre o modal de escolha. Só tem efeito em produtos cujo `Tipo` contenha "pacote" — o site então abre, por unidade, o mesmo modal de escolha usado pelos recheios de bolo, deixando escolher até 2 produtos dentre os resolvidos).

### 4. `Recheios Site`

`Recheio` (texto), `Mostrar` (checkbox).

### 5. `Limites Site`

`Dias` (select: Domingo, Segunda, Terça, Quarta, Quinta, Sexta, Sábado), `Limite` (número).

### 6. `Festas Site` (2026-07, criada à parte das 5 tables originais)

Table PRÓPRIA pra leads de orçamento de festa (`festas.html`), 1 row por lead — **sem** pai/subrows, sem preço, sem InfinitePay, sem Fila Cozinha, sem o ciclo de vida `STATUS_OPTS` dos pedidos normais. Substitui o reaproveitamento antigo de `Pedidos Site` (`Tipo Cliente='Festa'`) — motivo em `HISTORICO.md`.

| Coluna | Tipo | Observação |
|---|---|---|
| `Cliente` | Texto | |
| `WhatsApp` | Texto | |
| `Tipo Evento` | Texto | |
| `Nº Convidados` | Número | |
| `Local Evento` | Texto | |
| `Data Desejada` | Data | |
| `Hora` | Hora | |
| `Serviços Desejados` | Texto (multiline) | worker grava um serviço por linha, prefixado "• " |
| `Observações` | Texto (multiline) | |
| `Status` | Select: `Novo`, `Em Contato`, `Orçado`, `Fechado`, `Perdido` | default `Novo`; worker grava explícito na criação, não confia no default do Coda |

Criada e escrita pelo worker via `POST /novo-orcamento-festa` (constante `TABLE_FESTAS`), chamada por `festas.js`. Notifica o grupo Telegram de Festas (`TG_CHAT_FESTAS`), sem tópicos.

## Fases

1. ✅ **Tables criadas** (via IA do Coda). Atenção aos ajustes pendentes da fase 3.
2. ✅ **`/verificar-coda`** com `ok:true` — e agora também acusa **coluna de fórmula onde o código escreve** (`colunasComFormulaIndevida`; só `ID Pedido` e `Valor Item` podem ser calculadas) e exige a Option `Feito` no Status da Fila.
3. ✅ **Código migrado** (2026-07-16): tables por NOME pré-encodado (`Pedidos%20Site` etc. — as antigas `grid-...` viraram arquivo); `Adicionar`/`DEL`/`pbPosProcessarPedido` aposentados — o worker cria a row da fila direto (`pbCriarRowFila`: itens sem a taxa, `Valor da Entrega`, `Pago?`, `Status='Pendente'`) e atualiza pagamento por `pbAtualizarFila` (localiza por Cliente+Data+Hora); `/apagar-pedido` deleta pai+filhas via API; `/criar-pedido` virou recriação manual da row da fila; `/recheios` lê a coluna `Recheio` (+ filtro `Mostrar`); `painel-pedidos.js` lê `Fila Cozinha` por nome de coluna (fim dos IDs `c-...`).
   **Pendências manuais no Coda antes do deploy:**
   - Recriar a coluna `Produto` do `Pedidos Site` como **Texto simples** (a IA criou como lookup/fórmula — o código escreve nela; o `/verificar-coda` agora acusa isso).
   - Adicionar a Option **`Feito`** no `Status` da `Fila Cozinha`.
   - Recriar as **colunas-botão de cobrança** (se usadas): na `Fila Cozinha`, botão com `OpenWindow("https://coda-proxy.sitedluh.workers.dev/cobrar-pedido-base?rowId=" & thisRow.Id())`; na `Pedidos Site`, o equivalente do `/cobrar-total`.
4. **Teste ponta a ponta** com um pedido real: site → Telegram → confirmar → pagar → fila → painel → entregar → restante.
5. ✅ **Migração de dados automatizada** — `GET /migrar-coda?tabela=<produtos|recheios|limites|pedidos|fila|tudo>&confirmar=<0|1>`: copia das tables antigas (`grid-...`) pras novas. Sem `confirmar=1` é **dry-run** (só conta). **Idempotente**: pula o que já existe (produtos/recheios por nome, limites por dia, pedidos e fila por Cliente+Data+Hora). Pedidos migram em 2 passadas (pais → itens re-ligados ao pai novo via `addedRowIds`); Status legados da fila são mapeados (`Retirado`/`Finalizado`→`Entregue`, desconhecido→`Pendente`); `Pago?` é derivado de Valor Pago×Total quando não existir. **Caveats:** `ID Pedido` é fórmula — pedidos migrados ganham ID novo, então **link de pagamento pendente de pedido antigo não casa mais com o webhook** (re-gerar a cobrança pelos botões); imagens de produto são best-effort (podem precisar de re-upload manual). As tables velhas ficam intocadas (arquivo).

## Gotchas que continuam valendo

- Option/coluna com nome divergente = escrita silenciosamente perdida. **Use o `/verificar-coda` depois de qualquer mudança no Coda.**
- O painel continua com token Coda no cliente (dívida conhecida); a reconstrução não muda isso.
- Worker gitignored; deploy manual via wrangler.
