# Plano de implementação — Atendente de IA no WhatsApp (D'Luh Festas)

> Preparado em 2026-07-29. **Fonte de verdade** do domínio "IA de atendimento no WhatsApp".
> Ainda **não implementado**. Responsáveis: subagentes `whatsapp-ia-specialist` (dono do plano),
> `ia-local-infra` (PC/modelo/Whisper) e `ia-conversa-designer` (persona, prompt, roteiros).
>
> Decisões já tomadas pelo usuário nesta sessão estão marcadas com **[DECIDIDO]** — não rediscutir
> sem pedido explícito. O que ainda depende de medição real está em **[ABERTO]**.

---

## 1. Objetivo

Substituir o menu numérico morto do WhatsApp por uma **IA conversacional** que atende o cliente
como uma atendente humana atenderia. A prioridade do negócio continua sendo levar a pessoa pro
site — mas quem prefere resolver tudo pelo WhatsApp deve conseguir, sem sentir que está falando
com um robô de opções.

**[DECIDIDO] Escopo:** a IA pode fazer praticamente tudo — tirar dúvidas, montar o pedido item a
item, consultar prazos, consultar status. O único limite duro: **ela nunca confirma o pedido por
conta própria**. Antes de gravar qualquer coisa, ela recapitula o pedido inteiro e pergunta ao
cliente se está tudo certo. Só com o "sim" explícito do cliente ela segue exatamente o mesmo
caminho de quem passa pelo site (`POST /novo-pedido`), e o pedido nasce com a marca
**`[Feito por IA]`** no campo Observações.

---

## 2. Cenário atual (o que já existe e não precisa ser construído)

| Peça | Situação hoje |
|---|---|
| **Recebimento de WhatsApp** | Evolution API v2 (Baileys) rodando em Docker **no PC da empresa**, publicada via Tailscale Funnel (`EVO_URL`). Webhook chega no worker em `POST /webhook-evolution`. A Cloud API oficial da Meta também recebe (`/webhook-whatsapp`), mas o envio está preso em análise — `WA_MODO='evolution'`. |
| **Envio de WhatsApp** | `waEnviarTexto()` → `waEnviarTextoEvolution()`, com timeout de 8s e `delay` de 300ms (simula "digitando"). |
| **Estado conversacional** | KV `WA_ESTADO` (binding no `wrangler.jsonc`): `humano:<waid>` (modo atendimento humano, TTL 60min), `problema:<waid>`, `cancelar:<waid>`, `dedup:<msgid>`. |
| **Bot de triagem** | `waTriagem()` existe, com menu numerado 1–5, mas está **desligado**: `BOT_MENU_ATIVO = false`. Hoje o bot fica em silêncio total no inbound; a dona responde tudo à mão pelo WhatsApp Business. O **outbound automático** (link de pagamento, avisos de status, confirmações) **não** é afetado por esse flag e continua funcionando. |
| **Dados e regras** | Worker é o único escritor no Coda. Rotas prontas e reutilizáveis: `/produtos`, `/recheios`, `/horarios-disponiveis`, `/status-pedido`, `/novo-pedido`, `/cancelar-pedido`, `/ranking-produtos`. |
| **Painel operacional da dona** | Telegram, grupo "Dluh Pedidos" com Tópicos (Pendentes=6, Pagamentos=8, Confirmados=4). |

**Consequência prática:** isto não é um projeto do zero. É trocar o cérebro (`waTriagem` numérico)
por um cérebro conversacional, mantendo todo o encanamento — Evolution, KV, worker, Coda, Telegram.

---

## 3. Hardware e viabilidade (pesquisa de 2026-07-29)

**PC da empresa:** Ryzen 5 5500GT (6c/12t), 16 GB RAM, **GTX 1050 Ti 4 GB VRAM** (Pascal, compute
capability 6.1), Windows, já rodando o Docker da Evolution 24/7.

### O que cabe

| Modelo | Quant. | VRAM | Velocidade estimada | PT-BR / tool calling |
|---|---|---|---|---|
| **Qwen3-4B-Instruct-2507** | Q4_K_M | ~2,9 GB | ~20–22 tok/s | Recomendado. Melhor tool calling da faixa (~97,5% em eval independente), PT-BR "bom genérico" |
| Nemotron Nano 4B | Q4_K_M | ~3,0 GB | ~20–23 tok/s | 95% em tool calling, melhor em chamadas **sequenciais** |
| Gemma 3 4B / GAIA-PT-BR-4b | Q4_K_M | ~3,1 GB | ~21 tok/s | PT-BR mais natural (GAIA é treinado em português), mas tool calling fraco (~55%) |
| Phi-4-mini 3.8B | Q4_K_M | ~2,8 GB | ~24 tok/s | Rápido, tool calling fraco (~57%) |

Modelos de 7–8B **não cabem** inteiros nos 4 GB — só com parte na CPU, o que derruba a velocidade
a ponto de inviabilizar conversa em tempo real.

### Stack

- **Ollama** (roda sobre llama.cpp, suporta compute capability 5.0+; exige driver NVIDIA 570+ no
  Windows pra essa faixa). Caminho de menor atrito, API HTTP simples, `keep_alive` controla quanto
  tempo o modelo fica na VRAM.
- **vLLM está descartado**: exige compute capability 7.0+, a 1050 Ti é 6.1.
- **Convivência com a Evolution:** Baileys é Node puro, **não usa GPU**. Não há disputa de VRAM. Em
  RAM o quadro fecha nos 16 GB, mas sem folga — monitorar.

### Áudio **[DECIDIDO: transcrever sim; responder em áudio fica pra fase 2]**

- **faster-whisper** (CTranslate2), 4–8x mais rápido que o Whisper original com a mesma acurácia.
- Para PT-BR, preferir **large-v3** (~3 GB em INT8) ao `large-v3-turbo` — o turbo corta camadas do
  decodificador e perde mais em idiomas fora do inglês.
- Um áudio de 30s deve levar ~5–15s pra transcrever nessa GPU.
- **Whisper large-v3 + LLM não cabem juntos nos 4 GB.** A pipeline é sequencial por natureza
  (transcreve → depois responde), então alterna-se o carregamento; custo de poucos segundos em SSD.
  Alternativa se a troca incomodar: Whisper `small`/`turbo`, que deixa os dois residentes.

### Limite real

- **Latência:** ~5–15s por resposta de texto; ~15–25s quando envolve áudio. O prefill é o ponto
  fraco da Pascal (sem Tensor Cores) — **prompt e contexto precisam ser enxutos** (2–4K tokens).
  Nunca mandar o catálogo inteiro a cada turno: buscar só o recorte necessário via ferramenta.
- **Concorrência:** uma geração por vez. Isso **não** significa "uma pessoa por vez" — cada resposta
  ocupa a GPU por segundos e libera. Dez clientes conversando ao mesmo tempo funcionam; se duas
  mensagens caírem no mesmo instante, a segunda espera alguns segundos. **Não implementar fila de
  pessoas, nem timeout de inatividade, nem aviso de "já te atendo"** — a fila é de mensagens e o
  Ollama já serializa sozinho.
- **Memória de conversa não consome GPU nem RAM relevante** — é texto em disco/KV, recuperado a
  cada mensagem. Sobrevive a reinício do PC.

### Veredito honesto

A 1050 Ti é uma GPU de 2016 e não compete com API de nuvem em fluência nem em confiabilidade de
tool calling. Para **dúvidas de catálogo, preço, prazo e status** (leitura, risco baixo) ela dá
conta. Para **montar pedido** (onde um erro vira pedido errado no Coda, com dinheiro envolvido) o
risco não está no modelo escrever feio — está em ele chamar a ferramenta errada ou inventar
parâmetro. Por isso as travas do §7 são de **código**, não de prompt.

### **[ABERTO]** Plano B na nuvem — decidir depois do benchmark (Fase 0)

Custo de referência para ~50 conversas/dia × 10 mensagens (~12M tokens entrada + 2,25M saída/mês):
GPT-5 nano ~R$ 8/mês · DeepSeek V4-Flash ~R$ 12 · Gemini 3.1 Flash-Lite ~R$ 18 · GPT-5 mini ~R$ 21 ·
Claude Haiku 4.5 ~R$ 126. Ou seja: **custo não é o argumento** contra a nuvem nesse volume — o
argumento a favor do local é dado em casa, independência de internet e zero custo por mensagem.

Fallback previsto (a ligar ou não conforme o benchmark): PC fora do ar, modelo estourando timeout,
ou tool call malformada detectada pelo parser → a mensagem é atendida pela nuvem em vez de o
cliente ficar no vácuo. Sem nuvem, esse caso cai no Telegram pra dona assumir.

---

## 4. Arquitetura

### Onde mora o cérebro: **no PC, não no worker**

```
Cliente (WhatsApp)
   │
   ▼
Evolution API (Docker, PC da empresa)
   │  webhook
   ▼
Worker  /webhook-evolution ──── dedup, modo humano, cancelamento (como já é hoje)
   │        │
   │        └── IA ligada pra esse número? (KV) ──► encaminha a mensagem (fire-and-forget,
   │                                                 ctx.waitUntil, NÃO espera a resposta)
   ▼
Serviço de IA (PC da empresa, ao lado da Evolution)
   ├── transcreve áudio (faster-whisper)  ─┐  alterna
   ├── monta o contexto da conversa (SQLite local)
   ├── LLM (Ollama / Qwen3-4B) em loop de tool calling ─┘
   │        └── ferramentas chamam as ROTAS DO WORKER (catálogo, prazos, status, pedido)
   ├── valida a resposta (guardrails de código)
   └── envia pela Evolution em localhost (sem passar pelo túnel)
```

**Por que o cérebro não vai pro worker:** um turno com tool calling leva de 10 a 40 segundos e
várias idas e voltas. O worker responde webhook em milissegundos e já teve incidente de corrente
travada esperando o PC (documentado no `HISTORICO.md` — timeouts de 8s existem por causa disso).
O worker continua sendo **a fonte de verdade dos dados e das regras**; o serviço de IA só orquestra
a conversa e consome as rotas que já existem.

**Por que o ingresso continua no worker:** dedup, `humano:<waid>`, fluxo de cancelamento e o
outbound automático já vivem lá. Duplicar isso no PC criaria duas fontes de verdade.

### Estado

| Dado | Onde | Motivo |
|---|---|---|
| Histórico da conversa (últimas N mensagens) | **SQLite no PC** | Volumoso e falado a cada turno; local é instantâneo e não custa nada |
| `ia_pausado:<waid>` | **KV `WA_ESTADO`**, `expirationTtl` 8h | O worker precisa saber antes de encaminhar; expiração automática resolve o "esqueci de reativar" |
| `humano:<waid>` | KV (já existe) | Mantém a regra atual: dona assumiu, bot cala |
| `dedup:<msgid>` | KV (já existe) | Não mexer |
| Flag global `IA_ATIVA` + whitelist | Constante no worker | Kill switch e rollout controlado |

### Painel web

Página nova `atendimento.html` (padrão do `admin.html`), lendo por uma rota nova do worker
(`GET /ia-conversas`) que **faz proxy** do serviço do PC. **Nenhum segredo novo no cliente** — a
chave do serviço de IA fica no worker, nunca no HTML/JS (o token hardcoded do `painel-pedidos.js`
é uma falha conhecida que não deve ser repetida).

---

## 5. Comandos de controle **[DECIDIDO]**

| Comando | Efeito |
|---|---|
| **Pausar** (botão no Telegram ou comando de texto) | A IA para **na hora** de atender aquele número. Grava `ia_pausado:<waid>` no KV com `expirationTtl` de **8 horas** — se ninguém reativar, a IA volta sozinha ao fim desse prazo. |
| **Retomar** | Apaga `ia_pausado:<waid>` **e** o histórico da conversa no SQLite. A IA volta **do zero**, sem nenhum dado do que passou. |
| **Kill switch global** | Desliga a IA pra todos os contatos de uma vez, sem deploy (flag lida do KV). |

Os botões viajam junto de cada notificação de IA no Telegram (mesmo padrão dos botões
"Assumir"/"Resolvido" que já existem), e também funcionam por comando de texto.

---

## 6. Fluxo do pedido — a regra mais importante

**[DECIDIDO]** A IA monta o pedido conversando, mas a gravação é uma máquina de estados
determinística, não uma decisão do modelo:

1. **Coleta.** A IA vai preenchendo um rascunho (itens, quantidades, recheios, data, hora,
   retirada×entrega, endereço, forma de pagamento) usando as ferramentas — nunca de cabeça.
2. **Recapitulação obrigatória.** Antes de qualquer gravação, ela manda o resumo completo com
   valores e pergunta: *"está tudo certo assim?"*.
3. **Confirmação explícita do cliente.** Só um "sim/pode ser/confirma" do cliente libera o passo
   seguinte. Essa trava é **de código**: existe um campo `confirmado` no rascunho que só é marcado
   por essa etapa. Sem ele, a ferramenta de gravação **recusa a chamada**, mesmo que o modelo tente.
4. **Gravação pelo caminho padrão.** `POST /novo-pedido` com **o mesmo payload do checkout do site**
   (mesmo shape usado pelo pedido manual do admin), acrescentando `[Feito por IA]` nas Observações.
   A partir daí tudo se conecta sozinho: Telegram, ciclo de status, cobrança da entrada, fila da
   cozinha, avisos automáticos.
5. **Total recalculado no servidor.** O valor que vale é o que o worker calcula a partir do
   catálogo — o número que a IA falou na conversa nunca é fonte de verdade.

---

## 7. Guardrails — implementados como código, não como prompt **[DECIDIDO]**

| Regra | Como é garantida |
|---|---|
| **Nunca dar desconto ou mudar preço** | Preço só vem de `GET /produtos`. Validador pós-resposta: todo valor em R$ que aparecer na mensagem é conferido contra o catálogo em cache; divergência = mensagem bloqueada e conversa escalada pra dona. |
| **Nunca confirmar data/horário sem checar** | A ferramenta de data é obrigatória antes de qualquer frase que afirme disponibilidade. `/horarios-disponiveis` + Limites Site. |
| **Nunca prometer prazo/entrega fora da regra** | Antecedência mínima e área de entrega validadas por ferramenta; fora da regra, a IA diz que precisa confirmar e aciona a dona. |
| **Nunca cancelar pedido sozinha** | Cancelamento continua no fluxo existente (taxa escalonada, prévia + confirmação). A IA só explica e encaminha. |
| **Cliente fora do horário** | Mensagem chegando fora de 8h–19h **e/ou** cliente pedindo entrega/atendimento fora do horário de funcionamento → notificação no Telegram marcada como **"🌙 cliente fora do horário"**. **[ABERTO — confirmar com o usuário qual dos dois sentidos vale, ou se ambos]** |
| **Nunca inventar produto/sabor** | Se não está no catálogo, a resposta é "vou confirmar isso pra você" + escalada. |
| **Nunca mentir sobre ser IA** | Ver §8. |

Toda escalada usa o mesmo caminho: notificação no Telegram + `humano:<waid>` ativado (bot cala).

---

## 8. Persona e "soar humano" **[DECIDIDO]**

- A IA **se apresenta como atendente da D'Luh**, com nome próprio e tom da casa — não anuncia que é
  um robô por conta própria. **Mas se o cliente perguntar direto se está falando com um robô/IA, ela
  responde a verdade.** Sem exceção. Isso não é só ética: negar é o tipo de coisa que vira print.
- Mensagens curtas, quebradas em 2–3 balões como pessoa escreve — não um parágrafo único.
- Sem markdown, sem listas com traço, sem emoji em excesso (um aqui e ali, como a dona usa).
- **Debounce de 3–4 segundos:** cliente costuma mandar três mensagens seguidas. Esperar o silêncio
  antes de responder evita a IA responder a primeira frase enquanto a terceira chega — e é
  justamente o que faz parecer gente.
- Indicador de "digitando" via Evolution durante a geração — cobre boa parte dos 5–15s de latência.
- Nunca despejar o catálogo inteiro. Perguntar como uma vendedora perguntaria: pra quantas pessoas,
  que dia, doce ou salgado.

O `ia-conversa-designer` é dono do system prompt, dos exemplos de conversa e do conjunto de casos
de teste ("conversas de prova") que precisam passar antes de qualquer mudança de prompt ir ao ar.

---

## 9. Registro e visibilidade **[DECIDIDO]**

- **Painel web ao vivo** (`atendimento.html`): conversas em andamento, o que a IA respondeu, quais
  ferramentas ela chamou, botão de assumir/devolver, botão de pausar.
- **Resumo diário no Telegram**: quantas conversas, quantos pedidos gerados, o que ela não soube
  responder, quantas escaladas.
- **Tópico novo no grupo do Telegram** dedicado à IA — **pendência manual do usuário:** criar o
  tópico e mandar `id` dentro dele pra capturar o `message_thread_id` (mesmo procedimento dos
  tópicos Pendentes/Pagamentos/Confirmados).
- **Nada é gravado no Coda.** Só o pedido gerado, com `[Feito por IA]` nas Observações.

---

## 10. Rollout **[DECIDIDO]**

**Fase de teste: ao vivo, mas whitelist de um número só — o contato do dono.** A IA responde de
verdade, com todas as ferramentas ligadas, mas só conversa com quem está na lista. Cliente real
nenhum é exposto até a lista ser ampliada de propósito. Ampliação é uma constante no worker, sem
mexer em código de lógica.

---

## 11. Fases de implementação

| # | Fase | Responsável | Entregável |
|---|---|---|---|
| **0** | **Benchmark no PC real** | `ia-local-infra` | Ollama instalado, Qwen3-4B Q4_K_M rodando, medição de tok/s, latência ponta a ponta, qualidade de PT-BR e taxa de acerto de tool calling com as ferramentas reais. **Decide o [ABERTO] do fallback.** Sem esta fase, todo o resto é chute. |
| **1** | Esqueleto do serviço de IA | `whatsapp-ia-specialist` + `ia-local-infra` | Serviço no PC recebendo mensagem encaminhada pelo worker, respondendo pela Evolution, com histórico em SQLite. Whitelist do dono. Ainda sem ferramentas. |
| **2** | Encaminhamento e controle no worker | `worker-backend` | `/webhook-evolution` encaminha (fire-and-forget) quando a IA está ligada; `ia_pausado:<waid>` com TTL de 8h; botões de pausar/retomar no Telegram; kill switch global. |
| **3** | Ferramentas de leitura | `whatsapp-ia-specialist` | Catálogo, recheios, prazos, status do pedido. A IA já tira dúvidas de verdade. |
| **4** | Persona e roteiros | `ia-conversa-designer` | System prompt versionado, exemplos, casos de teste de conversa, debounce, quebra de balões, "digitando". |
| **5** | Montagem de pedido | `whatsapp-ia-specialist` + `worker-backend` | Rascunho, recapitulação, confirmação explícita, `POST /novo-pedido` com `[Feito por IA]`, validador de preço. Fase de maior risco — nada aqui vai ao ar sem os testes da fase 4 passando. |
| **6** | Áudio | `ia-local-infra` | faster-whisper large-v3, alternância de modelo, transcrição no fluxo. |
| **7** | Painel + resumo diário | `whatsapp-ia-specialist` + `admin-specialist` | `atendimento.html`, rota proxy `/ia-conversas`, resumo no tópico novo do Telegram. |
| **8** | Ampliar público | usuário | Tirar a whitelist por etapas. |

**Fase 2 do produto (fora deste escopo agora):** IA respondendo em áudio (voz sintética).

---

## 12. Pendências manuais do usuário

- [ ] Criar o **tópico novo no grupo do Telegram** e mandar `id` dentro dele (fase 7).
- [ ] Confirmar o sentido de **"cliente fora do horário"** (§7).
- [ ] Driver NVIDIA **570+** instalado no PC (requisito do Ollama pra compute capability 6.1).
- [ ] Espaço em disco: modelo (~3 GB) + Whisper large-v3 (~3 GB).
- [ ] Deploy do worker (`npx wrangler deploy`) a cada mudança das fases 2, 5 e 7 — o worker é
      gitignored e nunca vai pro Git.

---

## 13. Gotchas que valem pra este domínio

- **Worker é gitignored** (credenciais hardcoded: Coda, Telegram, Google OAuth, Evolution). Nunca
  commitar, nunca repetir os valores. Nenhuma chave nova do serviço de IA pode entrar no site.
- **`painel-pedidos.js` tem token Coda no cliente** — falha conhecida. Não repetir em
  `atendimento.html`: tudo passa pelo worker.
- **Coluna/Option faltando no Coda = escrita falha silenciosamente.** Vale pra qualquer campo novo.
- **A entrega de mensagens depende do PC estar de pé.** Já houve incidente de corrente travada
  esperando o PC dormindo — todo fetch pro PC precisa de timeout e nada pode ficar bloqueado
  esperando resposta da IA.
- **`BOT_MENU_ATIVO`** continua `false`. A IA **substitui** o menu numérico; religar o menu junto
  com a IA faria os dois brigarem pela mesma mensagem.
- **Prompt enxuto é requisito de hardware, não de estilo** — cada 1K tokens a mais de contexto custa
  segundos de latência nessa GPU.

---

## 14. Fontes da pesquisa de hardware (2026-07-29)

Os números do §3 são estimativas de terceiros, **não medição no PC da empresa** — por isso a Fase 0
existe. Principais fontes:

- [FitMyLLM — GTX 1050 Ti: specs e tok/s por modelo](https://www.fitmyllm.com/gpu/geforce-gtx-1050-ti)
- [J.D. Hodges — eval de 13 LLMs locais em tool calling (2026)](https://www.jdhodges.com/blog/local-llms-on-tool-calling-2026-pt1-local-lm/)
- [Ertas AI — Qwen3-4B vs Gemma vs Phi-4-mini em tool calling on-device](https://www.ertas.ai/blog/on-device-tool-calling-2026-qwen3-gemma4-phi4)
- [CEIA-UFG — Gemma-3-Gaia-PT-BR-4b (modelo treinado em português)](https://huggingface.co/CEIA-UFG/Gemma-3-Gaia-PT-BR-4b-it)
- [Ollama — suporte de GPU e compute capability](https://docs.ollama.com/gpu)
- [vLLM #19542 — sem kernel CUDA para compute capability 6.1](https://github.com/vllm-project/vllm/issues/19542)
- [llama.cpp #24485 — `GGML_CUDA_FA_ALL_QUANTS` e fallback silencioso pra CPU](https://github.com/ggml-org/llama.cpp/issues/24485)
- [codersera — faster-whisper vs whisper.cpp (2026)](https://codersera.com/blog/faster-whisper-vs-whisper-cpp-speech-to-text-2026/)
- Preços de nuvem: [OpenAI](https://www.cloudzero.com/blog/openai-pricing/) · [Gemini](https://www.cloudzero.com/blog/gemini-pricing/) · [Claude](https://www.cloudzero.com/blog/claude-api-pricing/) · [DeepSeek](https://www.cloudzero.com/blog/deepseek-pricing/)
