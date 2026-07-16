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

`Produto` (texto), `Ingredientes` (texto), `Valor` (moeda), `Quantidade mínima` (número), `Tipo` (select: os tipos do cardápio — Bolos, Doces, Salgados, Outros...), `Imagem` (imagem), `Mostrar` (checkbox), `Popular` (checkbox), `Valor Empresa` (moeda), `Quanti. Empresa` (número), `Mostrar Empresa` (checkbox).

### 4. `Recheios Site`

`Recheio` (texto), `Mostrar` (checkbox).

### 5. `Limites Site`

`Dias` (select: Domingo, Segunda, Terça, Quarta, Quinta, Sexta, Sábado), `Limite` (número).

## Fases

1. ✅ **Tables criadas** (via IA do Coda). Atenção aos ajustes pendentes da fase 3.
2. ✅ **`/verificar-coda`** com `ok:true` — e agora também acusa **coluna de fórmula onde o código escreve** (`colunasComFormulaIndevida`; só `ID Pedido` e `Valor Item` podem ser calculadas) e exige a Option `Feito` no Status da Fila.
3. ✅ **Código migrado** (2026-07-16): tables por NOME pré-encodado (`Pedidos%20Site` etc. — as antigas `grid-...` viraram arquivo); `Adicionar`/`DEL`/`pbPosProcessarPedido` aposentados — o worker cria a row da fila direto (`pbCriarRowFila`: itens sem a taxa, `Valor da Entrega`, `Pago?`, `Status='Pendente'`) e atualiza pagamento por `pbAtualizarFila` (localiza por Cliente+Data+Hora); `/apagar-pedido` deleta pai+filhas via API; `/criar-pedido` virou recriação manual da row da fila; `/recheios` lê a coluna `Recheio` (+ filtro `Mostrar`); `painel-pedidos.js` lê `Fila Cozinha` por nome de coluna (fim dos IDs `c-...`).
   **Pendências manuais no Coda antes do deploy:**
   - Recriar a coluna `Produto` do `Pedidos Site` como **Texto simples** (a IA criou como lookup/fórmula — o código escreve nela; o `/verificar-coda` agora acusa isso).
   - Adicionar a Option **`Feito`** no `Status` da `Fila Cozinha`.
   - Recriar as **colunas-botão de cobrança** (se usadas): na `Fila Cozinha`, botão com `OpenWindow("https://coda-proxy.sitedluh.workers.dev/cobrar-pedido-base?rowId=" & thisRow.Id())`; na `Pedidos Site`, o equivalente do `/cobrar-total`.
4. **Teste ponta a ponta** com um pedido real: site → Telegram → confirmar → pagar → fila → painel → entregar → restante.
5. Usuário passa os pedidos antigos que quiser pras tables novas (manual, sem pressa — as velhas ficam como arquivo).

## Gotchas que continuam valendo

- Option/coluna com nome divergente = escrita silenciosamente perdida. **Use o `/verificar-coda` depois de qualquer mudança no Coda.**
- O painel continua com token Coda no cliente (dívida conhecida); a reconstrução não muda isso.
- Worker gitignored; deploy manual via wrangler.
