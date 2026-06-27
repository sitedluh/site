// ── MEUS PEDIDOS (painel na home) ──────────────────────────────
// Mostra os pedidos do cliente (via /status-pedido, mesma rota do bot),
// com badge de status, aviso quando o status muda, botão de pagamento
// (sinal ou restante, reaproveitando o link já gerado pelo worker em
// "Link de Pagamento") e botão de cancelamento (via /cancelar-pedido).
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

let _mpTel='';
let _mpPollTimer=null;
let _mpFirstLoad=true;
let _mpUltimosPedidos=[];
let _mpCancelarIdPedido=null;
let _mpCancelandoId=null; // ID do pedido cujo cancelamento foi enviado mas o Coda ainda não refletiu — mantém o botão desabilitado até o próximo poll confirmar

function mpUltimoStatusKey(idPedido){return 'dluh_mp_status_'+idPedido;}
function mpToastKey(idPedido){return 'dluh_mp_toast_'+idPedido;}

function mpInit(){
  const tel=sbTelSalvo();
  const btn=document.getElementById('mp-trigger-btn');
  if(!btn)return;
  if(!tel){
    btn.style.display='none';
    mpEsconderBadge();
    if(_mpPollTimer){clearInterval(_mpPollTimer);_mpPollTimer=null;}
    return;
  }
  _mpTel=tel;
  btn.style.display='flex';
  if(!window._fbUser){
    // Botão aparece (já existe telefone salvo de pedido anterior), mas sem
    // login ainda não dá pra buscar status — o aviso "Entrar com Google" só
    // aparece quando o cliente clica no botão e abre o modal (mpAbrirModal).
    mpEsconderBadge();
    if(_mpPollTimer){clearInterval(_mpPollTimer);_mpPollTimer=null;}
    return;
  }
  mpCarregar();
  if(!_mpPollTimer)_mpPollTimer=setInterval(mpCarregar,45000);
}

function mpEsconderBadge(){
  const btn=document.getElementById('mp-trigger-btn');
  if(btn)btn.classList.remove('mp-unread');
}

// Abre o modal "Meus Pedidos" (botão no header, ao lado do perfil) — antes
// esse conteúdo (login ou lista) ficava fixo numa seção na home.
function mpAbrirModal(){
  const modal=document.getElementById('mp-modal-pedidos');
  if(!modal)return;
  document.getElementById('mp-trigger-btn')?.classList.remove('mp-unread');
  if(!window._fbUser){
    document.getElementById('mp-login').style.display='';
    document.getElementById('mp-lista').innerHTML='';
  }else{
    document.getElementById('mp-login').style.display='none';
    mpCarregar(); // atualiza na hora de abrir, não só espera o próximo ciclo do polling de 45s
  }
  modal.classList.add('open');
}
function mpFecharModal(){
  document.getElementById('mp-modal-pedidos').classList.remove('open');
}

async function mpFazerLogin(){
  if(!window._fbSignIn)return;
  try{await window._fbSignIn();mpInit();mpAbrirModal();}catch(_){}
}

async function mpCarregar(){
  if(!_mpTel||!window._fbUser)return;
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/status-pedido?tel=${encodeURIComponent(_mpTel)}`);
    const d=await res.json().catch(()=>({}));
    const pedidos=(d&&d.encontrado&&d.pedidos)||[];
    // Limpa o estado de "cancelando" assim que o status do pedido deixar de permitir
    // cancelamento (Cancelado chegou do Coda) ou o pedido sumiu da listagem.
    if(_mpCancelandoId){
      const pd=pedidos.find(p=>p.idPedido===_mpCancelandoId);
      if(!pd||!MP_PODE_CANCELAR.includes(pd.status)){_mpCancelandoId=null;}
    }
    pedidos.forEach(p=>{
      const tKey=mpToastKey(p.idPedido);
      const ultimoToast=localStorage.getItem(tKey);
      if(_mpFirstLoad){
        localStorage.setItem(tKey,p.status);
        return;
      }
      if(ultimoToast!==p.status){
        localStorage.setItem(tKey,p.status);
        dluhNotificar(`📦 Pedido atualizado: ${p.status}`);
      }
    });
    _mpFirstLoad=false;
    mpRenderLista(pedidos);
    mpRenderTriggerBadge(pedidos);
  }catch(e){
    console.warn('Erro ao carregar Meus Pedidos:',e);
  }
}

const MP_STATUS_CLS={
  'Aguardando confirmação':'mp-st-aguardando',
  'Confirmado — Esperando pagamento':'mp-st-confirmado',
  'Pago — Em produção':'mp-st-preparo',
  'Entregue — Esperando restante':'mp-st-entregue',
  'Finalizado':'mp-st-final',
  'Cancelado':'mp-st-cancelado',
};
const MP_PODE_CANCELAR=['Aguardando confirmação','Confirmado — Esperando pagamento','Pago — Em produção'];
// Acende o ponto vermelho (.mp-unread) no botão "Pedidos" do header quando há
// algum pedido cujo status ainda não foi marcado como visto pelo cliente (mpMarcarVisto).
function mpRenderTriggerBadge(pedidos){
  const btn=document.getElementById('mp-trigger-btn');
  if(!btn)return;
  const temNovo=(pedidos||[]).some(p=>localStorage.getItem(mpUltimoStatusKey(p.idPedido))!==p.status);
  btn.classList.toggle('mp-unread',temNovo);
}

function mpRenderLista(pedidos){
  _mpUltimosPedidos=pedidos;
  const el=document.getElementById('mp-lista');
  if(!el)return;
  if(!pedidos.length){el.innerHTML='<div class="mp-vazio">Nenhum pedido encontrado com esse número.</div>';return;}
  el.innerHTML=pedidos.map(mpCardHtml).join('');
}

function mpCardHtml(p){
  const cls=MP_STATUS_CLS[p.status]||'mp-st-aguardando';
  const ultimoVisto=localStorage.getItem(mpUltimoStatusKey(p.idPedido));
  const mudou=ultimoVisto&&ultimoVisto!==p.status;
  const itensResumo=(p.itens||[]).slice(0,3).map(i=>`${i.quantidade}x ${i.produto}`).join(', ');
  const podePagar=!!p.linkPagamento&&(p.status==='Confirmado — Esperando pagamento'||p.status==='Entregue — Esperando restante');
  const valorPagar=p.status==='Entregue — Esperando restante'?p.restante:(p.entrada||p.total);
  const podeCancelar=MP_PODE_CANCELAR.includes(p.status);
  // Enquanto o POST de cancelamento já foi enviado mas o Coda ainda não refletiu o
  // novo status, mostra o botão desabilitado ("⏳ Cancelando...") para evitar duplo envio.
  // _mpCancelandoId é limpo pelo mpCarregar() assim que o status deixar de permitir cancelamento.
  const estaCancelando=p.idPedido===_mpCancelandoId;
  return `<div class="mp-card" data-idpedido="${esc(p.idPedido)}" onclick="mpMarcarVisto('${esc(p.idPedido)}')">
    <div class="mp-card-top">
      <span class="mp-badge ${cls}">${esc(p.status)}</span>
      ${mudou?'<span class="mp-novo">🔔 Atualizado</span>':''}
    </div>
    <div class="mp-card-data">${esc(p.data?(p.horario?p.data+' às '+p.horario:p.data):'')}</div>
    <div class="mp-card-itens">${esc(itensResumo)}</div>
    <div class="mp-card-valores">${p.total?`Total: ${fmtBRL(p.total)}`:''}${p.valorPago?` · Pago: ${fmtBRL(p.valorPago)}`:''}${p.restante>0?` · Falta: ${fmtBRL(p.restante)}`:''}</div>
    <div class="mp-card-actions">
      ${podePagar?`<button class="mp-btn-pagar" onclick="event.stopPropagation();window.open('${esc(p.linkPagamento)}','_blank')">💳 Pagar ${fmtBRL(valorPagar)}</button>`:''}
      ${estaCancelando?'<button class="mp-btn-cancelar" disabled>⏳ Cancelando...</button>':podeCancelar?`<button class="mp-btn-cancelar" onclick="event.stopPropagation();mpIniciarCancelamento('${esc(p.idPedido)}')">❌ Cancelar</button>`:''}
    </div>
  </div>`;
}

function mpMarcarVisto(idPedido){
  const p=_mpUltimosPedidos.find(x=>x.idPedido===idPedido);
  if(p)localStorage.setItem(mpUltimoStatusKey(idPedido),p.status);
  mpRenderLista(_mpUltimosPedidos);
}

async function mpIniciarCancelamento(idPedido){
  _mpCancelarIdPedido=idPedido;
  const modal=document.getElementById('mp-modal-cancelar');
  const body=document.getElementById('mp-modal-cancelar-body');
  const btn=document.getElementById('mp-modal-cancelar-confirmar');
  body.innerHTML='Calculando taxa de cancelamento...';
  btn.disabled=true;
  btn.textContent='Confirmar cancelamento';
  modal.classList.add('open');
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/cancelar-pedido`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pedidoId:idPedido,tel:_mpTel,confirmar:false})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||!d||d.ok!==true){
      body.innerHTML=`<div class="mp-cancel-erro">${esc((d&&d.error)||'Não foi possível calcular o cancelamento.')}</div>`;
      btn.disabled=true;
      return;
    }
    const feePct=d.feePct||0;
    const valorPago=d.valorPago||0;
    const valorRetido=d.valorRetido||0;
    const valorReembolso=d.valorReembolso!=null?d.valorReembolso:(valorPago-valorRetido);
    let html='';
    if(valorPago<=0){
      html='<p>Esse pedido ainda não tem pagamento registrado. Pode ser cancelado sem nenhuma taxa.</p>';
    }else if(feePct<=0){
      html=`<p>Você está dentro do prazo de cancelamento sem taxa (até 2 dias após a confirmação).</p>
        <p>Valor pago: <strong>${fmtBRL(valorPago)}</strong> — reembolso integral.</p>`;
    }else{
      html=`<p>Esse pedido já passou do prazo sem taxa. Como a entrega está mais próxima, a taxa de cancelamento é de <strong>${feePct}%</strong> sobre o valor pago.</p>
        <p>Valor pago: ${fmtBRL(valorPago)}<br>Taxa: ${fmtBRL(valorRetido)}<br>Reembolso estimado: <strong>${fmtBRL(valorReembolso)}</strong></p>`;
    }
    html+='<p style="margin-top:10px;color:var(--text3);font-size:12px">Essa ação não pode ser desfeita.</p>';
    body.innerHTML=html;
    btn.disabled=false;
  }catch(e){
    body.innerHTML='<div class="mp-cancel-erro">Erro ao consultar. Tente novamente.</div>';
    btn.disabled=true;
  }
}

function mpFecharModalCancelar(){
  document.getElementById('mp-modal-cancelar').classList.remove('open');
  _mpCancelarIdPedido=null;
}

async function mpConfirmarCancelamento(){
  if(!_mpCancelarIdPedido)return;
  const btn=document.getElementById('mp-modal-cancelar-confirmar');
  btn.disabled=true;
  btn.textContent='Cancelando...';
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/cancelar-pedido`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pedidoId:_mpCancelarIdPedido,tel:_mpTel,confirmar:true})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||!d||d.ok!==true){
      showToast((d&&d.error)||'Não foi possível cancelar o pedido.');
      btn.disabled=false;
      btn.textContent='Confirmar cancelamento';
      return;
    }
    showToast('✅ Pedido cancelado.');
    // Marca o pedido como "cancelando" ANTES de fechar o modal (que zera _mpCancelarIdPedido),
    // para que mpCardHtml() mostre "⏳ Cancelando..." enquanto o Coda não confirma o novo status.
    _mpCancelandoId=_mpCancelarIdPedido;
    mpFecharModalCancelar();
    mpCarregar();
  }catch(e){
    showToast('Erro ao cancelar. Tente novamente.');
    btn.disabled=false;
    btn.textContent='Confirmar cancelamento';
  }
}
