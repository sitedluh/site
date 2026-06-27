// ── Bot de Status do Pedido (chat próprio, sem depender do Tawk) ──
// Bot de triagem da D'Luh: substitui o redirect direto pro WhatsApp depois do
// pedido por um chat próprio, orientado a botões (em vez de texto livre), que
// identifica a necessidade do cliente (status / novo pedido / dúvidas / atendente)
// e o encaminha pro fluxo certo. Toda folha do fluxo oferece "voltar ao menu" e
// saída pra atendente; qualquer falha de integração cai pro fallback de WhatsApp.
let _statusBotTel='';
let _sbEtapa=null; // null | 'telefone' | 'data' — o que o campo de texto livre espera agora
let _sbInactivityTimer=null;
let _sbTawkAtivo=false;       // true enquanto uma conversa com atendente foi iniciada via sbAtendente()
let _sbContextoAtendente=''; // último contexto do fluxo do bot antes de chamar sbAtendente()

function sbTelSalvo(){
  try{
    const saved=localStorage.getItem('dluh_userdata');
    if(saved){const d=JSON.parse(saved);if(d&&d.tel)return d.tel;}
  }catch(_){}
  return '';
}

// ─────────────────────────────────────────────────────────────

function abrirStatusBot(mensagemInicial,fullscreen,semAutoPopular){
  // FAB 📦 sempre abre o bot — sem intercepção para o Tawk. O botão #sb-tawk-fab
  // (aparece acima do FAB quando a conversa com atendente está minimizada) é o único
  // ponto de re-entrada para o Tawk; os dois sistemas são completamente independentes.
  const panel=document.getElementById('status-bot-panel');
  panel.classList.add('open');
  panel.classList.toggle('fullscreen',!!fullscreen);
  document.getElementById('status-bot-fab').classList.add('hide');
  document.getElementById('status-bot-fab').classList.remove('sb-unread');
  if(!_statusBotTel)_statusBotTel=sbTelSalvo();
  const msgs=document.getElementById('status-bot-msgs');
  if(!msgs.dataset.iniciado){
    msgs.dataset.iniciado='1';
    if(semAutoPopular){
      // Quem chamou (ex.: acompanhamento pós-pedido, seção 2.5) já vai montar
      // o conteúdo do chat sozinho — não populamos nada aqui.
    }else if(mensagemInicial){
      // Aberto logo após um pedido: a mensagem já explica a situação, então só
      // oferece as saídas padrão em vez de repetir o menu principal.
      sbAddMsg('bot',mensagemInicial);
      sbAddMsg('bot','Posso ajudar em mais alguma coisa?');
      sbFimOpcoes();
    }else{
      sbMenuPrincipal('Oi! 👋 Aqui é o assistente da D\'Luh Festas. Pra te ajudar rapidinho, me conta o que você precisa:');
    }
  }
  sbResetInatividade();
}
function fecharStatusBot(){
  const panel=document.getElementById('status-bot-panel');
  panel.classList.remove('open');
  panel.classList.remove('fullscreen');
  document.getElementById('status-bot-fab').classList.remove('hide');
  if(_sbInactivityTimer){clearTimeout(_sbInactivityTimer);_sbInactivityTimer=null;}
}
function sbAddMsg(quem,texto){
  const msgs=document.getElementById('status-bot-msgs');
  const div=document.createElement('div');
  div.className='sb-msg '+quem;
  div.textContent=texto;
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
  // Enquanto há um pedido sendo acompanhado (_sbPollTel ativo), mantém a sessão salva
  // a cada mensagem nova — é o que permite a conversa sobreviver a um F5 ou ao X.
  if(_sbPollTel)sbSalvarSessao();
  // Avisa o cliente quando chega mensagem de atualização e o painel não está aberto
  // (toast sempre; notificação do navegador quando a aba está em segundo plano).
  if(quem==='bot')sbAvisarNovaMensagem(texto);
}
// Painel fechado = mensagem chegou em segundo plano (caso típico: polling do
// acompanhamento pós-pedido) — avisa e marca o FAB com um ponto de "não lida".
function sbAvisarNovaMensagem(texto){
  const panel=document.getElementById('status-bot-panel');
  if(panel&&panel.classList.contains('open'))return; // já está vendo a conversa
  dluhNotificar('📦 '+texto);
  const fab=document.getElementById('status-bot-fab');
  if(fab)fab.classList.add('sb-unread');
}

// Timeout de inatividade: depois de alguns minutos sem interação, pergunta se
// o cliente ainda está por aí e volta pro menu principal (regra transversal #4).
function sbResetInatividade(){
  if(_sbInactivityTimer)clearTimeout(_sbInactivityTimer);
  _sbInactivityTimer=setTimeout(()=>{
    const panel=document.getElementById('status-bot-panel');
    if(panel&&panel.classList.contains('open')){
      sbLimparBotoes();
      sbEsconderInput();
      sbMenuPrincipal('Ainda por aí? Posso te ajudar em algo? 🙂');
    }
  },3*60*1000);
}

// ── Botões de opção (em vez de texto livre, reduz erro e acelera) ──
function sbBotoes(opcoes){
  sbLimparBotoes();
  const msgs=document.getElementById('status-bot-msgs');
  const row=document.createElement('div');
  row.className='sb-botoes';
  opcoes.forEach(op=>{
    const btn=document.createElement('button');
    btn.className='sb-btn-opcao';
    btn.textContent=op.label;
    btn.onclick=()=>{
      row.remove();
      sbAddMsg('user',op.label);
      sbResetInatividade();
      op.onClick();
    };
    row.appendChild(btn);
  });
  msgs.appendChild(row);
  msgs.scrollTop=msgs.scrollHeight;
  sbResetInatividade();
}
function sbLimparBotoes(){
  document.querySelectorAll('#status-bot-msgs .sb-botoes').forEach(el=>el.remove());
}

// ── Campo de texto livre (telefone/data), mostrado só quando necessário ──
function sbMostrarInput(etapa,placeholder,botaoLabel){
  _sbEtapa=etapa;
  const row=document.getElementById('status-bot-input-row');
  const input=document.getElementById('status-bot-tel');
  const btn=document.getElementById('status-bot-btn');
  row.classList.remove('sb-hide');
  input.placeholder=placeholder;
  input.value='';
  input.type=etapa==='telefone'?'tel':'text';
  input.inputMode=etapa==='telefone'?'numeric':'text';
  btn.textContent=botaoLabel;
  input.focus();
}
function sbEsconderInput(){
  _sbEtapa=null;
  document.getElementById('status-bot-input-row').classList.add('sb-hide');
}
function sbInputSubmit(){
  const input=document.getElementById('status-bot-tel');
  const valor=(input.value||'').trim();
  if(!valor)return;
  const etapa=_sbEtapa;
  sbAddMsg('user',valor);
  sbResetInatividade();
  if(etapa==='telefone')return sbStatusConsultar(valor);
  if(etapa==='data')return sbDuvidaPrazosConsultar(valor);
}

// Fallback de WhatsApp — usado sempre que uma integração falha (Coda, Tawk, status).
// Botão clicável em vez de window.open() direto, porque aqui o disparo costuma vir
// depois de um await (erro de fetch), então não é mais um gesto síncrono do usuário
// e o navegador pode bloquear um popup automático.
// 'waUrl' é opcional — quando informado (caso do acompanhamento pós-pedido), o
// WhatsApp já abre com o resumo do pedido pré-preenchido (padrão antigo, de antes
// do bot existir), em vez de um chat em branco.
function sbWhatsappFallback(motivo,waUrl){
  sbAddMsg('bot',`${motivo} Me chama no WhatsApp que resolvo rapidinho. 👇`);
  sbBotoes([
    {label:'👉 Abrir WhatsApp',onClick:()=>window.open(waUrl||`https://wa.me/${CONFIG.WHATSAPP}`,'_blank')},
  ]);
}

// Botões padrão de saída, oferecidos no fim de qualquer dúvida respondida.
function sbFimOpcoes(){
  sbBotoes([
    {label:'🛒 Quero fazer um pedido',onClick:()=>sbNovoPedido()},
    {label:'🔁 Voltar ao menu',onClick:()=>sbMenuPrincipal()},
    {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
  ]);
}

// ── 2.0 — Menu principal ──
function sbMenuPrincipal(saudacao){
  _sbContextoAtendente='menu';
  sbEsconderInput();
  if(saudacao)sbAddMsg('bot',saudacao);
  sbAddMsg('bot','O que você precisa? 😊');
  sbBotoes([
    {label:'📦 Status do meu pedido',onClick:()=>{sbExigeLogin(sbStatusPedirTelefone);}},
    {label:'🛒 Fazer um pedido',onClick:()=>{sbNovoPedido();}},
    {label:'❓ Tirar uma dúvida',onClick:()=>{sbExigeLogin(sbDuvidas);}},
    {label:'💬 Falar com um atendente',onClick:()=>{sbAtendente();}},
  ]);
}

// ── 2.0.1 — Login obrigatório (Status, Dúvidas e acompanhamento pós-pedido) ──
// "Fazer um pedido" e "Falar com atendente" continuam abertos, sem login.
function sbExigeLogin(continuarCom){
  if(window._fbUser){ continuarCom(); return; }
  sbEsconderInput();
  sbAddMsg('bot','Pra te mostrar isso com segurança, preciso te identificar. É rapidinho: entra com sua conta Google. 🔒');
  sbBotoes([
    {label:'🔵 Entrar com Google',onClick:()=>sbFazerLogin(continuarCom)},
    {label:'🔙 Voltar ao menu',onClick:()=>sbMenuPrincipal()},
  ]);
}
async function sbFazerLogin(continuarCom){
  if(!window._fbSignIn){ sbWhatsappFallback('Login indisponível agora.'); return; }
  try{
    await window._fbSignIn();
    continuarCom();
  }catch(e){
    sbAddMsg('bot','Sem problema! Essa parte precisa de login. Quer tentar de novo ou falar com a gente?');
    sbBotoes([
      {label:'🔵 Entrar com Google',onClick:()=>sbFazerLogin(continuarCom)},
      {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
      {label:'🔙 Voltar ao menu',onClick:()=>sbMenuPrincipal()},
    ]);
  }
}

// Chamado depois que o pedido é registrado no Coda com sucesso (substitui irParaWhatsapp).
// Seção 2.5: em vez de só explicar a situação, o bot posta o resumo do pedido aqui no
// próprio chat (mesmo texto que ia pro WhatsApp) e passa a acompanhar o status em tempo
// real (polling em /status-pedido), avisando sozinho quando o estoque for confirmado
// (link de pagamento automático) e quando o pagamento cair.
function abrirStatusBotPosPedido(p){
  _sbContextoAtendente='pos-pedido';
  fecharPedidoLoading();
  _statusBotTel=p.tel||sbTelSalvo();
  const msgs=document.getElementById('status-bot-msgs');
  if(msgs){msgs.innerHTML='';delete msgs.dataset.iniciado;}
  abrirStatusBot(null,true,true);
  // Resumo do pedido entra no chat como se fosse o cliente mandando (Passo 1) —
  // textContent não renderiza o *negrito* do WhatsApp, então tiramos os asteriscos.
  if(p.msg)sbAddMsg('user',p.msg.replace(/\*/g,''));
  sbAddMsg('bot','Pedido recebido! ✅ Já tô verificando o estoque dos itens com a cozinha. Assim que confirmar, mando o link de pagamento aqui mesmo. 🙂');
  sbAddMsg('bot','⏳ Seu pedido está sendo verificado pela nossa equipe.');
  sbBotoes([{label:'🔄 Atualizar status',onClick:()=>sbAtualizarStatusManual()}]);
  sbIniciarAcompanhamento(_statusBotTel,p.waUrl,p.paiId);
  sbPedirPermissaoNotificacao();
}

// ── 2.5 (notas técnicas) — Acompanhamento automático pós-pedido, via polling ──
// Continua rodando em segundo plano mesmo se o cliente fechar o painel (as mensagens
// ficam guardadas e aparecem quando ele reabrir); para sozinho ao chegar em "Pago — Em
// produção" (fim do que esta seção cobre) ou depois de falhas seguidas (cai no fallback
// de WhatsApp, regra transversal #2).
let _sbPollTimer=null;
let _sbPollTel=null;
let _sbPollUltimoStatus=null;
let _sbPollFalhas=0;
let _sbPollWaUrl=null; // guarda o link wa.me com o resumo do pedido, pro fallback usar
let _sbPollPaiId=null; // ID (Coda) do pedido recém-criado — rastreia ESSE pedido específico, não "o mais recente da lista"
let _sbPollNaoAchou=0; // tentativas seguidas sem achar _sbPollPaiId na listagem (consistência eventual do Coda)
let _sbPollLinkPagamento=null; // link de cobrança já avisado ao cliente (persistido pra reconstruir o botão "Pagar agora" após reload)
let _sbPollEntradaValor=null; // valor cobrado já avisado ao cliente (idem)

// ── Persistência da sessão de acompanhamento (localStorage) ──────────
// Sem isso, um F5 (ou às vezes até fechar/reabrir o painel) zerava _sbPollTimer e todo
// o estado em memória — o polling parava de rodar e o cliente nunca recebia o aviso de
// cobrança que o bot ia postar sozinho mais tarde. Persistimos transcript + estado do
// polling e retomamos tudo no carregamento da página (sbRestaurarSessao, chamado no
// DOMContentLoaded).
const SB_SESSAO_KEY='dluh_sb_sessao';
function sbSalvarSessao(){
  if(!_sbPollTel)return;
  try{
    const msgsEls=document.querySelectorAll('#status-bot-msgs .sb-msg');
    const mensagens=Array.from(msgsEls).slice(-60).map(el=>({
      quem:el.classList.contains('user')?'user':'bot',
      texto:el.textContent,
    }));
    localStorage.setItem(SB_SESSAO_KEY,JSON.stringify({
      tel:_sbPollTel,
      paiId:_sbPollPaiId,
      waUrl:_sbPollWaUrl,
      status:_sbPollUltimoStatus,
      linkPagamento:_sbPollLinkPagamento,
      entrada:_sbPollEntradaValor,
      mensagens,
    }));
  }catch(_){}
}
function sbLimparSessao(){
  try{localStorage.removeItem(SB_SESSAO_KEY);}catch(_){}
  _sbPollTel=null;_sbPollPaiId=null;_sbPollWaUrl=null;_sbPollUltimoStatus=null;_sbPollLinkPagamento=null;_sbPollEntradaValor=null;
}
function sbRestaurarSessao(){
  let sessao=null;
  try{
    const saved=localStorage.getItem(SB_SESSAO_KEY);
    if(saved)sessao=JSON.parse(saved);
  }catch(_){}
  if(!sessao||!sessao.tel||!sessao.mensagens||!sessao.mensagens.length)return;
  // Status terminal — não há mais nada a acompanhar, não vale a pena restaurar.
  if(['Pago — Em produção','Finalizado','Cancelado'].includes(sessao.status)){sbLimparSessao();return;}
  const msgs=document.getElementById('status-bot-msgs');
  if(!msgs)return;
  _statusBotTel=sessao.tel;
  msgs.innerHTML='';
  sessao.mensagens.forEach(m=>sbAddMsg(m.quem,m.texto));
  msgs.dataset.iniciado='1';
  if(sessao.status==='Confirmado — Esperando pagamento'&&sessao.linkPagamento){
    sbBotoes([
      {label:'💳 Pagar agora',onClick:()=>window.open(sessao.linkPagamento,'_blank')},
      {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
    ]);
  }else if(sessao.status==='Aguardando confirmação'||!sessao.status){
    sbBotoes([{label:'🔄 Atualizar status',onClick:()=>sbAtualizarStatusManual()}]);
  }else{
    sbFimOpcoes();
  }
  // Retoma o polling em segundo plano, sem abrir o painel sozinho.
  _sbPollTel=sessao.tel;
  _sbPollPaiId=sessao.paiId||null;
  _sbPollWaUrl=sessao.waUrl||null;
  // Se o status salvo é 'Confirmado — Esperando pagamento' mas linkPagamento não estava
  // disponível ainda, restaura _sbPollUltimoStatus como 'Aguardando confirmação' para que
  // o próximo ciclo do poll detecte a transição e poste a mensagem de pagamento com o
  // botão. Sem esse ajuste, o guard 'atual.status===_sbPollUltimoStatus' bloquearia todos
  // os ciclos seguintes em silêncio e o bot nunca enviaria a mensagem.
  _sbPollUltimoStatus=(sessao.status==='Confirmado — Esperando pagamento'&&!sessao.linkPagamento)
    ?'Aguardando confirmação'
    :(sessao.status||'Aguardando confirmação');
  _sbPollLinkPagamento=sessao.linkPagamento||null;
  _sbPollEntradaValor=sessao.entrada||null;
  _sbPollFalhas=0;
  _sbPollNaoAchou=0;
  sbChecarStatusPedido();
  _sbPollTimer=setInterval(sbChecarStatusPedido,12000);
}

function sbIniciarAcompanhamento(tel,waUrl,paiId){
  sbPararAcompanhamento();
  if(!tel)return;
  _sbPollTel=tel;
  _sbPollUltimoStatus='Aguardando confirmação';
  _sbPollFalhas=0;
  _sbPollWaUrl=waUrl||null;
  _sbPollPaiId=paiId||null;
  _sbPollNaoAchou=0;
  _sbPollLinkPagamento=null;
  _sbPollEntradaValor=null;
  sbSalvarSessao(); // grava já de início, pra um reload logo após o pedido não perder o resumo
  // 1ª checagem já dispara na hora (em vez de esperar os 12s do 1º tick do
  // interval) — evita que uma falha transiente bem no começo (ex.: Coda ainda
  // processando, rede instável) já conte demais antes de dar tempo de tentar de novo.
  sbChecarStatusPedido();
  _sbPollTimer=setInterval(sbChecarStatusPedido,12000);
}
function sbPararAcompanhamento(){
  if(_sbPollTimer){clearInterval(_sbPollTimer);_sbPollTimer=null;}
}
async function sbChecarStatusPedido(){
  if(!_sbPollTel)return;
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/status-pedido?tel=${encodeURIComponent(_sbPollTel)}`);
    const d=await res.json().catch(()=>({}));
    const pedidos=(d&&d.encontrado&&d.pedidos)||[];
    if(!res.ok||!pedidos.length)throw new Error('sem pedido');
    _sbPollFalhas=0;
    // Rastreia o pedido recém-criado PELO ID, não "o primeiro da lista" — logo após o
    // pedido, o Coda pode ainda não ter atualizado a listagem (consistência eventual) e o
    // mais recente DISPONÍVEL pode ser, por coincidência, um pedido antigo (até cancelado)
    // do mesmo telefone — foi exatamente isso que causou o bot avisar status errado.
    let atual;
    if(_sbPollPaiId){
      atual=pedidos.find(pd=>pd.idPedido===_sbPollPaiId);
      if(!atual){
        _sbPollNaoAchou++;
        // Só por segurança: se depois de várias tentativas o pedido específico nunca
        // aparece (não deveria acontecer), desiste de rastrear por ID e volta pro
        // critério antigo, pra não ficar travado em silêncio pro resto da sessão.
        if(_sbPollNaoAchou>=8){ _sbPollPaiId=null; atual=pedidos[0]; }
        else return;
      }else{
        _sbPollNaoAchou=0; // encontrou — zera para não acumular falhas não-consecutivas
      }
    }else{
      atual=pedidos[0]; // sem ID pra rastrear — mais recente da lista (worker já ordena assim)
    }
    if(atual.status===_sbPollUltimoStatus)return;
    if(atual.status==='Confirmado — Esperando pagamento'){
      if(!atual.linkPagamento)return; // link ainda sendo gerado — espera o próximo ciclo
      // parseFloat: "entrada" e "total" chegam crus do Coda e podem vir como string
      // (ex.: "150.00") em vez de number — fmtBRL(string) lança TypeError. Antes dessa
      // correção, _sbPollUltimoStatus era definido ANTES do sbAddMsg: se a chamada
      // lançasse, o guard "atual.status===_sbPollUltimoStatus" bloqueava TODOS os
      // ciclos seguintes, deixando o bot travado em silêncio sem nunca postar a cobrança.
      const entradaNum=parseFloat(atual.entrada)||parseFloat(atual.total)||0;
      _sbPollLinkPagamento=atual.linkPagamento;
      _sbPollEntradaValor=entradaNum;
      sbAddMsg('bot',`Estoque confirmado! ✅ Pra garantir seu pedido, é só fazer o pagamento de ${fmtBRL(entradaNum)}:`);
      // Só marca como "já avisado" DEPOIS que a mensagem entrou no DOM — se sbAddMsg
      // lançar por qualquer razão, o próximo ciclo do poll tenta novamente.
      _sbPollUltimoStatus=atual.status;
      sbBotoes([
        {label:'💳 Pagar agora',onClick:()=>window.open(atual.linkPagamento,'_blank')},
        {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
      ]);
      sbAddMsg('bot','Assim que o pagamento cair, eu confirmo aqui pra você. 💳');
    }else if(atual.status==='Pago — Em produção'){
      _sbPollUltimoStatus=atual.status;
      sbAddMsg('bot','Pagamento confirmado! 🎉 Seu pedido está confirmado e já entrou em produção.\nMuito obrigado pela preferência! 💛 Qualquer coisa, é só chamar a gente por aqui.');
      sbBotoes([
        {label:'🔁 Voltar ao menu',onClick:()=>sbMenuPrincipal()},
        {label:'💬 Falar com a gente',onClick:()=>sbAtendente()},
      ]);
      sbPararAcompanhamento();
      sbLimparSessao(); // fim do que o acompanhamento automático cobre — não há mais o que persistir
    }else if(atual.status==='Aguardando confirmação'){
      _sbPollUltimoStatus=atual.status;
    }else{
      // Foge do que essa seção cobre (ex.: já foi direto pra Entregue/Finalizado) —
      // avisa com a explicação padrão e encerra o acompanhamento automático.
      _sbPollUltimoStatus=atual.status;
      const explicacao=STATUS_BOT_EXPLICACAO[atual.status];
      sbAddMsg('bot',explicacao?`Atualização do seu pedido: ${explicacao}`:`Status atualizado: ${atual.status}`);
      sbFimOpcoes();
      sbPararAcompanhamento();
      sbLimparSessao();
    }
  }catch(e){
    _sbPollFalhas++;
    if(_sbPollFalhas>=5){
      sbPararAcompanhamento();
      sbWhatsappFallback('Tive um probleminha pra acompanhar seu pedido automaticamente.',_sbPollWaUrl);
      sbLimparSessao();
    }
  }
}

// Atualização manual: disparada pelo botão "Atualizar status" no fluxo pós-pedido.
// Faz uma consulta avulsa ao worker e exibe o estado atual sem alterar o polling automático,
// exceto quando o status já mudou — nesse caso trata o resultado diretamente para não
// depender do próximo ciclo de 12s (e evita race condition de dupla-exibição ao resetar
// _sbPollUltimoStatus e chamar sbChecarStatusPedido de fora).
async function sbAtualizarStatusManual(){
  if(!_sbPollTel&&!sbTelSalvo())return;
  sbLimparBotoes();
  sbAddMsg('bot','Verificando... ⏳');
  try{
    const tel=(_sbPollTel||sbTelSalvo()).replace(/\D/g,'');
    const res=await fetch(`${CONFIG.WORKER_URL}/status-pedido?tel=${encodeURIComponent(tel)}`);
    const d=await res.json().catch(()=>({}));
    const pedidos=(d&&d.encontrado&&d.pedidos)||[];
    const atual=pedidos.length?((_sbPollPaiId&&pedidos.find(pd=>pd.idPedido===_sbPollPaiId))||pedidos[0]):null;
    if(!atual||atual.status==='Aguardando confirmação'){
      sbAddMsg('bot','⏳ Seu pedido ainda está sendo verificado pela nossa equipe. Assim que houver novidade, te aviso aqui!');
      sbBotoes([{label:'🔄 Atualizar status',onClick:()=>sbAtualizarStatusManual()}]);
    }else if(atual.status==='Confirmado — Esperando pagamento'&&atual.linkPagamento){
      const entradaNum=parseFloat(atual.entrada)||parseFloat(atual.total)||0;
      _sbPollLinkPagamento=atual.linkPagamento;
      _sbPollEntradaValor=entradaNum;
      _sbPollUltimoStatus=atual.status;
      sbAddMsg('bot',`Estoque confirmado! ✅ Pra garantir seu pedido, é só fazer o pagamento de ${fmtBRL(entradaNum)}:`);
      sbBotoes([
        {label:'💳 Pagar agora',onClick:()=>window.open(atual.linkPagamento,'_blank')},
        {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
      ]);
      sbAddMsg('bot','Assim que o pagamento cair, eu confirmo aqui pra você. 💳');
      sbSalvarSessao();
    }else if(atual.status==='Pago — Em produção'){
      _sbPollUltimoStatus=atual.status;
      sbAddMsg('bot','Pagamento confirmado! 🎉 Seu pedido está confirmado e já entrou em produção.\nMuito obrigado pela preferência! 💛 Qualquer coisa, é só chamar a gente por aqui.');
      sbBotoes([
        {label:'🔁 Voltar ao menu',onClick:()=>sbMenuPrincipal()},
        {label:'💬 Falar com a gente',onClick:()=>sbAtendente()},
      ]);
      sbPararAcompanhamento();
      sbLimparSessao();
    }else{
      _sbPollUltimoStatus=atual.status;
      const explicacao=STATUS_BOT_EXPLICACAO[atual.status];
      sbAddMsg('bot',explicacao?`Atualização do seu pedido: ${explicacao}`:`Status atualizado: ${atual.status}`);
      sbFimOpcoes();
      sbPararAcompanhamento();
      sbLimparSessao();
    }
  }catch(e){
    sbAddMsg('bot','Não consegui verificar agora. Tente novamente em alguns instantes.');
    sbBotoes([{label:'🔄 Atualizar status',onClick:()=>sbAtualizarStatusManual()}]);
  }
}

// ── 2.1 — Status do pedido ──
const STATUS_BOT_EXPLICACAO={
  'Aguardando confirmação':'sua equipe ainda vai confirmar o estoque dos itens. Assim que confirmar, te aviso por aqui e pelo WhatsApp.',
  'Confirmado — Esperando pagamento':'o estoque já foi confirmado! Falta só o pagamento da entrada pra entrar em produção.',
  'Pago — Em produção':'a entrada foi paga e seu pedido já está sendo produzido com todo cuidado. 🎂',
  'Entregue — Esperando restante':'seu pedido já foi entregue! Falta só o pagamento do restante pra finalizar.',
  'Finalizado':'esse pedido já foi concluído — pagamento e entrega 100% ok. Obrigada pela confiança! 🩷',
  'Cancelado':'esse pedido foi cancelado.',
};

function sbStatusPedirTelefone(){
  sbEsconderInput();
  // Regra "não pedir dado que já tem": se o telefone já é conhecido (pedido
  // recente ou salvo no navegador), confirma em vez de pedir de novo.
  if(_statusBotTel){
    const final4=_statusBotTel.replace(/\D/g,'').slice(-4);
    sbAddMsg('bot',`Notei que você já usou um número terminando em ${final4} aqui. Quer consultar esse mesmo número?`);
    sbBotoes([
      {label:'✅ Sim, esse mesmo',onClick:()=>sbStatusConsultar(_statusBotTel)},
      {label:'📱 Usar outro número',onClick:()=>sbStatusPedirTelefoneInput()},
    ]);
    return;
  }
  sbStatusPedirTelefoneInput();
}
function sbStatusPedirTelefoneInput(){
  sbAddMsg('bot','Beleza! Me passa o telefone (com DDD) que você usou no pedido que eu já verifico. 📱');
  sbMostrarInput('telefone','Seu WhatsApp (com DDD)','Ver status');
}
async function sbStatusConsultar(tel){
  const telDigits=(tel||'').replace(/\D/g,'');
  if(telDigits.length<8){
    sbAddMsg('bot','Esse número não parece completo — digite o WhatsApp com DDD que você usou no pedido (ex: 11999998888).');
    sbMostrarInput('telefone','Seu WhatsApp (com DDD)','Ver status');
    return;
  }
  _statusBotTel=tel;
  sbEsconderInput();
  sbAddMsg('bot','Só um instante, verificando... ⏳');
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/status-pedido?tel=${encodeURIComponent(telDigits)}`);
    const d=await res.json().catch(()=>({}));
    const pedidos=(d&&d.encontrado&&d.pedidos)||[];
    const STATUS_INATIVO=['Finalizado','Cancelado'];
    const pedidosAtivos=pedidos.filter(p=>!STATUS_INATIVO.includes(p.status));
    if(!res.ok||!pedidosAtivos.length){
      const semAtivo=res.ok&&pedidos.length&&!pedidosAtivos.length;
      sbAddMsg('bot',semAtivo?'Não encontrei pedidos ativos com esse número. Pedidos finalizados ou cancelados não aparecem aqui. Quer:':'Hmm, não achei nenhum pedido com esse telefone. 🤔 Quer:');
      sbBotoes([
        {label:'📱 Tentar outro número',onClick:()=>sbStatusPedirTelefoneInput()},
        {label:'🛒 Fazer um pedido',onClick:()=>sbNovoPedido()},
        {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
      ]);
      return;
    }
    pedidosAtivos.forEach(p=>{
      const explicacao=STATUS_BOT_EXPLICACAO[p.status]||'';
      let txt=`Pedido de ${p.data||'data a confirmar'} — status: ${p.status}`;
      if(explicacao)txt+=`\n${explicacao}`;
      if(p.itens&&p.itens.length)txt+='\n\nItens: '+p.itens.map(i=>`${i.quantidade}x ${i.produto}`).join(', ');
      if(p.total>0){
        txt+=`\n\nTotal: ${fmtBRL(p.total)} · Pago até agora: ${fmtBRL(p.valorPago)}`;
        if(p.restante>0)txt+=` · Falta: ${fmtBRL(p.restante)}`;
      }
      sbAddMsg('bot',txt);
    });
    sbAddMsg('bot','Posso ajudar em mais alguma coisa?');
    const pagaveis=pedidosAtivos.filter(p=>p.status==='Confirmado — Esperando pagamento'&&p.linkPagamento);
    const botoesConsulta=[];
    pagaveis.forEach(p=>{
      botoesConsulta.push({label:pagaveis.length>1?`💳 Pagar pedido de ${p.data||'data a confirmar'}`:'💳 Pagar agora',onClick:()=>window.open(p.linkPagamento,'_blank')});
    });
    botoesConsulta.push(
      {label:'🛒 Quero fazer um pedido',onClick:()=>sbNovoPedido()},
      {label:'🔁 Voltar ao menu',onClick:()=>sbMenuPrincipal()},
      {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
    );
    sbBotoes(botoesConsulta);
  }catch(e){
    console.warn('Erro ao consultar status:',e);
    sbWhatsappFallback('Tive um probleminha pra consultar agora.');
  }
}

// ── 2.2 — Fazer um pedido ──
function sbNovoPedido(){
  sbEsconderInput();
  sbAddMsg('bot','Que delícia! 🎂 É um pedido pra você ou pra sua empresa/evento?');
  sbBotoes([
    {label:'🙋 Pra mim (pessoa física)',onClick:()=>sbNovoPedidoFisica()},
    {label:'🏢 Pra empresa (B2B)',onClick:()=>sbNovoPedidoEmpresa()},
  ]);
}
function sbNovoPedidoFisica(){
  sbAddMsg('bot','Pra pedidos de pessoa física, é só usar nosso cardápio normal.');
  sbBotoes([
    {label:'🙋 Abrir cardápio normal',onClick:()=>{window.open('cardapio.html','_blank');sbNovoPedidoAjuda();}},
    {label:'👍 Depois eu vejo',onClick:()=>sbNovoPedidoAjuda()},
  ]);
}
function sbNovoPedidoEmpresa(){
  // Já estamos no empresas.html (B2B) — não precisa de link.
  sbAddMsg('bot','Boa notícia: você já está no lugar certo! É só fechar este chat, rolar a página e montar seu pedido aqui mesmo. 😉');
  sbNovoPedidoAjuda();
}
function sbNovoPedidoAjuda(){
  sbAddMsg('bot','Quer ajuda pra escolher sabores ou montar o pedido?');
  sbBotoes([
    {label:'💬 Sim, me ajuda',onClick:()=>sbAtendente()},
    {label:'👍 Não, valeu',onClick:()=>sbMenuPrincipal()},
  ]);
}

// ── 2.3 — Dúvidas ──
function sbNormalizaProdutoBot(row){
  if(row.nome!==undefined){
    const valorUnit=Number(row.valorEmpresa!==undefined?row.valorEmpresa:row.valor)||0;
    const qtdMin=Number(row.qtdMinEmpresa!==undefined?row.qtdMinEmpresa:row.qtdMin)||1;
    const mostrarEmpresa=row.mostrarEmpresa!==undefined?row.mostrarEmpresa:true;
    return{nome:row.nome||'',tipo:row.tipo||'Outros',valorUnit,qtdMin,mostrarEmpresa};
  }
  return{
    nome:row.values?.[CONFIG.COLS.nome]||'',
    tipo:row.values?.[CONFIG.COLS.tipo]||'Outros',
    valorUnit:parseBRL(row.values?.[CONFIG.COLS.valor]),
    qtdMin:parseInt(row.values?.[CONFIG.COLS.qtdMin])||1,
    mostrarEmpresa:row.values?.['Mostrar Empresa'],
  };
}
async function sbProdutosCache(){
  if(allProducts&&allProducts.length)return allProducts;
  const res=await fetch(`${CONFIG.WORKER_URL}/produtos`);
  if(!res.ok)throw new Error('produtos '+res.status);
  const d=await res.json();
  return(d.produtos||d.items||[]).map(sbNormalizaProdutoBot).filter(p=>p.nome&&p.mostrarEmpresa!==false);
}
async function sbRecheiosCache(){
  if(recheios&&recheios.length)return recheios;
  const res=await fetch(`${CONFIG.WORKER_URL}/recheios`);
  if(!res.ok)throw new Error('recheios '+res.status);
  const d=await res.json();
  return(d.recheios||d.items||[]).map(r=>typeof r==='string'?r:(r.nome||r.values?.['Recheios']||r.name||'')).filter(Boolean);
}

function sbDuvidas(){
  _sbContextoAtendente='duvidas';
  sbEsconderInput();
  sbAddMsg('bot','Pode perguntar! Sobre o que é sua dúvida?');
  sbBotoes([
    {label:'🍰 Sabores e recheios',onClick:()=>{sbDuvidaSabores();}},
    {label:'💰 Preços',onClick:()=>{sbDuvidaPrecos();}},
    {label:'📅 Prazos e datas',onClick:()=>{sbDuvidaPrazos();}},
    {label:'❓ Outra dúvida',onClick:()=>{sbAtendente();}},
  ]);
}
async function sbDuvidaSabores(){
  sbAddMsg('bot','Deixa eu ver o que temos disponível agora... 🔎');
  try{
    const [prods,rech]=await Promise.all([sbProdutosCache(),sbRecheiosCache().catch(()=>[])]);
    if(!prods.length)throw new Error('sem produtos');
    const nomes=[...new Set(prods.map(p=>p.nome))].slice(0,15);
    let txt='Hoje trabalhamos com:\n\n'+nomes.map(n=>`• ${n}`).join('\n');
    if(rech.length)txt+='\n\nRecheios disponíveis: '+rech.slice(0,12).join(', ');
    sbAddMsg('bot',txt);
  }catch(e){
    sbWhatsappFallback('Tive um probleminha pra buscar nosso catálogo agora.');
    return;
  }
  sbAddMsg('bot','Respondi sua dúvida? 😊');
  sbFimOpcoes();
}
async function sbDuvidaPrecos(){
  sbAddMsg('bot','Buscando nossos preços... 💰');
  try{
    const prods=await sbProdutosCache();
    const validos=prods.filter(p=>p.valorUnit>0).slice(0,15);
    if(!validos.length)throw new Error('sem produtos');
    const txt='Alguns dos nossos preços empresariais (por unidade):\n\n'+validos.map(p=>`• ${p.nome}: ${fmtBRL(p.valorUnit)}`+(p.qtdMin>1?` (mín. ${p.qtdMin})`:'')).join('\n')+'\n\nO cardápio completo com fotos tá aqui na página, é só rolar! 😉';
    sbAddMsg('bot',txt);
  }catch(e){
    sbWhatsappFallback('Tive um probleminha pra buscar os preços agora.');
    return;
  }
  sbAddMsg('bot','Respondi sua dúvida? 😊');
  sbFimOpcoes();
}
function sbDuvidaPrazos(){
  sbAddMsg('bot','Pra eu ver a disponibilidade certinha, me diz a data desejada (formato dd/mm/aaaa). 📅');
  sbMostrarInput('data','dd/mm/aaaa','Ver disponibilidade');
}
async function sbDuvidaPrazosConsultar(valor){
  const m=(valor||'').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(!m){
    sbAddMsg('bot','Não entendi a data — usa o formato dd/mm/aaaa (ex: 15/08/2026).');
    sbMostrarInput('data','dd/mm/aaaa','Ver disponibilidade');
    return;
  }
  const [, dd, mm, yyyy]=m;
  const dataStr=`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  sbEsconderInput();
  sbAddMsg('bot','Só um instante, checando a agenda... ⏳');
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/horarios-disponiveis?data=${encodeURIComponent(dataStr)}`);
    if(!res.ok)throw new Error('horarios '+res.status);
    const d=await res.json();
    const livres=(d.slots||[]).filter(s=>s.disponivel);
    if(d.limiteGlobal===0){
      sbAddMsg('bot',`Em ${valor} (${d.diaSemana||'esse dia'}) a gente não atende — está fora da nossa agenda. Bora escolher outra data?`);
    }else if(livres.length>0){
      sbAddMsg('bot',`Boa notícia! ${valor} ainda tem horários disponíveis. 🎉\n\nPra travar a data certinha, é só montar seu pedido aqui mesmo no cardápio.`);
    }else{
      sbAddMsg('bot',`Hmm, ${valor} já está bem concorrido e não sobrou horário livre. 😕 Quer tentar outra data ou falar com a equipe?`);
    }
  }catch(e){
    sbWhatsappFallback('Tive um probleminha pra checar a disponibilidade agora.');
    return;
  }
  sbAddMsg('bot','Respondi sua dúvida? 😊');
  sbFimOpcoes();
}

// ── 2.4 — Falar com atendente ──
function sbAtendente(contexto){
  if(contexto)_sbContextoAtendente=contexto;
  const h=new Date().getHours();
  if(h<8||h>=19){
    sbEsconderInput();
    sbAddMsg('bot','Nosso atendimento humano funciona das 8h às 19h. Tente novamente nesse horário! 😊');
    sbFimOpcoes();
    return;
  }
  sbEsconderInput();
  try{
    if(window.Tawk_API&&typeof window.Tawk_API.maximize==='function'){
      sbAddMsg('bot','Tô te transferindo pra um atendente agora. Só um instante! 💬');
      // Envia contexto e identidade ao Tawk antes de abrir o widget
      try{
        if(window._fbUser&&typeof Tawk_API.setAttributes==='function')
          Tawk_API.setAttributes({name:window._fbUser.displayName||'',email:window._fbUser.email||''},function(){});
        const tags=['bot-dluh'];
        if(_sbContextoAtendente)tags.push(_sbContextoAtendente);
        if(typeof Tawk_API.addTags==='function')Tawk_API.addTags(tags,function(){});
        if(typeof Tawk_API.addEvent==='function')
          Tawk_API.addEvent('atendente-solicitado',{origem:_sbContextoAtendente||'bot',pagina:'empresas'},function(){});
      }catch(_){}
      if(typeof window.Tawk_API.showWidget==='function')window.Tawk_API.showWidget();
      window.Tawk_API.maximize();
      fecharStatusBot();
      // Desliza o FAB pro lado enquanto o Tawk ocupa o mesmo canto (volta ao normal em onChatMinimized).
      const fab=document.getElementById('status-bot-fab');
      if(fab)fab.classList.add('sb-lado');
      _sbTawkAtivo=true;
      return;
    }
  }catch(_){}
  sbWhatsappFallback('Nosso chat ao vivo está indisponível no momento.');
}
// Reabre o widget do Tawk quando a conversa com atendente está ativa mas minimizada.
// Chamado pelo botão #sb-tawk-fab (aparece em onChatMinimized quando _sbTawkAtivo=true).
function sbReabrirAtendente(){
  try{
    if(window.Tawk_API&&typeof window.Tawk_API.maximize==='function'){
      if(typeof window.Tawk_API.showWidget==='function')window.Tawk_API.showWidget();
      window.Tawk_API.maximize();
      const fab=document.getElementById('status-bot-fab');
      if(fab)fab.classList.add('sb-lado');
      const tawkBtn=document.getElementById('sb-tawk-fab');
      if(tawkBtn){tawkBtn.classList.remove('visible');tawkBtn.classList.remove('sb-tawk-unread');}
    }
  }catch(_){}
}

function sbPedirPermissaoNotificacao(){
  try{
    if(window.Notification&&Notification.permission==='default')Notification.requestPermission();
  }catch(_){}
}

// ── 4 — Oculta FAB 📦 e botão de atendente enquanto carrinho ou checkout estão abertos ──
// MutationObserver no #drawer (classe 'open') e #checkout-page (classe 'active').
// Adiciona .sb-nav-hide (display:none!important definido no CSS) em ambos os elementos;
// remove quando as duas condições deixam de ser verdadeiras.
(function sbIniciarObservadorNavegacao(){
  function _sbAtualizarVisibilidadeFab(){
    const drawer=document.getElementById('drawer');
    const checkout=document.getElementById('checkout-page');
    const ocultar=!!(drawer&&drawer.classList.contains('open'))||(checkout&&checkout.classList.contains('active'));
    const fab=document.getElementById('status-bot-fab');
    const tawkFab=document.getElementById('sb-tawk-fab');
    if(fab)fab.classList.toggle('sb-nav-hide',!!ocultar);
    if(tawkFab)tawkFab.classList.toggle('sb-nav-hide',!!ocultar);
  }
  const obs=new MutationObserver(_sbAtualizarVisibilidadeFab);
  const drawer=document.getElementById('drawer');
  const checkout=document.getElementById('checkout-page');
  if(drawer)obs.observe(drawer,{attributes:true,attributeFilter:['class']});
  if(checkout)obs.observe(checkout,{attributes:true,attributeFilter:['class']});
})();

