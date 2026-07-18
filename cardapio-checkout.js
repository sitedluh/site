function goCheckout(){
  closeDrawer();
  // Exige login antes de finalizar
  if(!window._fbUser){
    showLoginRequired();
    return;
  }
  // Esconde elementos desnecessários no checkout (mobile)
  const floatBtn=document.getElementById('cart-float');
  if(floatBtn)floatBtn.style.display='none';
  const profile=document.querySelector('.profile');
  if(profile)profile.style.display='none';
  const items=Object.values(cart).filter(i=>i.qty>0);
  const topperCount=items.filter(i=>topperPorProduto[i.id]?.quero).length;
  const topperExtra=topperCount*20;
  const taxaEntrega=(getRadio('rg-entrega')==='Entrega em endereço'?(_taxaEntregaAtual||0):0);
  const total=items.reduce((s,i)=>s+i.valorUnit*i.qty,0)+topperExtra+taxaEntrega;
  document.getElementById('order-review').innerHTML=`<div class="order-review">
    ${items.map(i=>{
      let linhas=`<div class="order-review-item"><span>${i.nome} · ${i.qty} unid.</span><span>${fmtBRL(i.valorUnit*i.qty)}</span></div>`;
      if((isBolo(i.tipo)||isPacote(i.tipo))&&i.recheios){
        const rotulo=isBolo(i.tipo)?'Bolo':'Pacote';
        i.recheios.forEach((r,idx)=>{
          linhas+=`<div style="font-size:12px;color:#666;padding:2px 0 2px 12px">${rotulo} ${idx+1}: ${r.length?r.join(' + '):'sem recheio'}</div>`;
        });
      }
      if(topperPorProduto[i.id]?.quero){
        linhas+=`<div class="order-review-item" style="font-size:12px;color:var(--accent)"><span>  └ Topper personalizado</span><span>${fmtBRL(20)}</span></div>`;
      }
      return linhas;
    }).join('')}
    ${topperExtra>0?`<div class="order-review-item" style="font-size:13px;color:var(--text2)"><span>Toppers (${topperCount}x)</span><span>${fmtBRL(topperExtra)}</span></div>`:''}
    ${taxaEntrega>0?`<div class="order-review-item" style="font-size:13px;color:var(--text2)"><span>🛵 Taxa de entrega</span><span>${fmtBRL(taxaEntrega)}</span></div>`:''}
    <div class="order-review-total"><span>Total</span><span>${fmtBRL(total)}</span></div>
  </div>`;
  document.getElementById('catalog-page').classList.add('hidden');
  document.getElementById('checkout-page').classList.add('active');
  // Injeta/atualiza barra de steps
  let bar = document.getElementById('checkout-steps-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'checkout-steps-bar';
    bar.innerHTML = `
    <div class="cstep" data-step="0"><span class="cstep-num">1</span><span class="cstep-label">Resumo</span></div>
    <div class="cstep-line"></div>
    <div class="cstep" data-step="1"><span class="cstep-num">2</span><span class="cstep-label">Dados</span></div>
    <div class="cstep-line"></div>
    <div class="cstep" data-step="2"><span class="cstep-num">3</span><span class="cstep-label">Entrega</span></div>
    <div class="cstep-line"></div>
    <div class="cstep" data-step="3"><span class="cstep-num">4</span><span class="cstep-label">Pagamento</span></div>
  `;
    const checkoutPage = document.getElementById('checkout-page');
    if (checkoutPage) checkoutPage.insertBefore(bar, checkoutPage.firstChild);
  }
  setCheckoutStep(0);
  initCheckoutStepObserver();
  document.body.classList.add('checkout-active');
  window.scrollTo(0,0);
  // Nenhuma opção de entrada vem pré-selecionada — escolha obrigatória do cliente
  const fEntradaPct=document.getElementById('f-entrada-pct');
  if(fEntradaPct)fEntradaPct.value='';
  document.querySelectorAll('#rg-entrada-pct .radio-opt').forEach(o=>o.classList.remove('active'));
  atualizarEntrada();
  loadUserData();
  goCheckoutPushState();
  // Pré-preenche nome se logado
  const fNome=document.getElementById('f-nome');
  if(fNome&&!fNome.value&&window._fbUser)fNome.value=window._fbUser.displayName||'';
}

function showCatalog(){
  if (window._checkoutStepObserver) {
    window._checkoutStepObserver.disconnect();
    window._checkoutStepObserver = null;
  }
  document.getElementById('checkout-page').classList.remove('active');
  document.getElementById('catalog-page').classList.remove('hidden');
  document.body.classList.remove('checkout-active');
  window.scrollTo(0,0);
  const profile=document.querySelector('.profile');
  if(profile)profile.style.display='';
  renderDrawer();
}

function setCheckoutStep(idx) {
  document.querySelectorAll('.cstep').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.classList.toggle('done', i < idx);
  });
}

function initCheckoutStepObserver() {
  if (window._checkoutStepObserver) window._checkoutStepObserver.disconnect();
  requestAnimationFrame(() => {
    const sections = Array.from(document.querySelectorAll('#checkout-page .ck-section'));
    if (!sections.length) return;
    window._checkoutStepObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) {
        const idx = sections.indexOf(visible[0].target);
        if (idx >= 0) setCheckoutStep(idx);
      }
    }, { threshold: 0.3 });
    sections.forEach(el => window._checkoutStepObserver.observe(el));
  });
}

// ── BOTÃO VOLTAR DO CELULAR ──
function goCheckoutPushState(){
  history.pushState({page:'checkout'},'','#checkout');
}

window.addEventListener('popstate',(e)=>{
  const ckPage=document.getElementById('checkout-page');
  if(ckPage&&ckPage.classList.contains('active')){
    showCatalog();
  }
});
function selectRadio(el,groupId){document.querySelectorAll('#'+groupId+' .radio-opt').forEach(o=>o.classList.remove('active'));el.classList.add('active');if(groupId==='rg-entrega'){document.getElementById('row-end').style.display=el.dataset.val==='Entrega em endereço'?'block':'none';saveUserData();if(el.dataset.val==='Entrega em endereço'&&document.getElementById('f-cep')?.value)calcDeliveryFee();}atualizarEntrada();}

function selecionarEntradaPct(el,pct){document.querySelectorAll('#rg-entrada-pct .radio-opt').forEach(o=>o.classList.remove('active'));el.classList.add('active');const f=document.getElementById('f-entrada-pct');if(f)f.value=pct;atualizarEntrada();}

// Espelha no front a regra do worker (deveCobrarTotalAntecipado): pedidos com Total < R$100
// E entrega em até 1 dia da data do pedido são cobrados o TOTAL de uma vez. Aproximação por
// dia de calendário — o worker é a fonte de verdade real (cálculo por timestamp completo).
function calculaCobrancaAntecipada(){
  const items=Object.values(cart).filter(i=>i.qty>0);
  const topperBonus=items.filter(i=>topperPorProduto[i.id]?.quero).length*20;
  const taxaFrete=getRadio('rg-entrega')==='Entrega em endereço'?(_taxaEntregaAtual||0):0;
  const total=items.reduce((s,i)=>s+i.valorUnit*i.qty,0)+topperBonus+taxaFrete;
  const dataVal=document.getElementById('f-data')?.value;
  if(!dataVal||total<=0||total>=100)return false;
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const dataEsc=new Date(dataVal+'T00:00:00');
  const diffDias=Math.round((dataEsc-hoje)/86400000);
  return diffDias>=0&&diffDias<=1;
}

// Aplica (ou desfaz) a regra "pedido pequeno + última hora". Quando ativa: força
// "Pagar Valor Total", desabilita visualmente "Entrada de 50%" e mostra a nota. Mexe no DOM
// direto (sem chamar atualizarEntrada/selecionarEntradaPct) pra não recursar. Não roda quando
// paga em Dinheiro (a seção fica escondida de qualquer forma). Quando inativa, só reabilita o
// botão de 50% — NÃO re-seleciona nada (a escolha continua manual/obrigatória).
function aplicarCobrancaAntecipada(){
  const grupo=document.getElementById('rg-entrada-pct');
  const btn50=grupo?grupo.querySelector('.radio-opt[data-val="50"]'):null;
  const btn100=grupo?grupo.querySelector('.radio-opt[data-val="100"]'):null;
  const f=document.getElementById('f-entrada-pct');
  const nota=document.getElementById('entrada-antecipada-note');
  const ativa=getRadio('rg-pgto')!=='Dinheiro'&&calculaCobrancaAntecipada();
  if(ativa){
    if(f)f.value='100';
    if(btn50){btn50.classList.remove('active');btn50.style.opacity='0.4';btn50.style.pointerEvents='none';btn50.title='Pedido pequeno com entrega em até 1 dia é pago integralmente no ato';}
    if(btn100)btn100.classList.add('active');
    if(nota)nota.style.display='block';
  }else{
    if(btn50){btn50.style.opacity='';btn50.style.pointerEvents='';btn50.title='';}
    if(nota)nota.style.display='none';
  }
}

function atualizarEntrada(){
  const items=Object.values(cart).filter(i=>i.qty>0);
  const topperBonus=items.filter(i=>topperPorProduto[i.id]?.quero).length*20;
  const taxaFrete=getRadio('rg-entrega')==='Entrega em endereço'?(_taxaEntregaAtual||0):0;
  const total=items.reduce((s,i)=>s+i.valorUnit*i.qty,0)+topperBonus+taxaFrete;
  // Regra "pedido pequeno + última hora" pode forçar 100% antes de calcular os valores
  aplicarCobrancaAntecipada();
  const raw=document.getElementById('f-entrada-pct')?.value||'';
  const lblPct=document.getElementById('entrada-pct-label');
  const elVal=document.getElementById('entrada-val');
  const elResto=document.getElementById('entrada-resto');
  // Sem escolha ainda: placeholder em vez de assumir 50% por padrão
  if(raw!=='50'&&raw!=='100'){
    if(lblPct)lblPct.textContent='—';
    if(elVal)elVal.textContent='—';
    if(elResto)elResto.textContent='—';
    return;
  }
  const pct=parseInt(raw,10)/100;
  const entrada=Math.round(total*pct*100)/100;
  const resto=Math.round((total-entrada)*100)/100;
  if(lblPct)lblPct.textContent=Math.round(pct*100)+'%';
  if(elVal)elVal.textContent=fmtBRL(entrada);
  if(elResto)elResto.textContent=fmtBRL(Math.max(0,resto));
}
function getRadio(groupId){const a=document.querySelector('#'+groupId+' .radio-opt.active');return a?a.dataset.val:'';}
// Carrega os horários disponíveis (slots fixos de 15 em 15 min, 08:00–19:00) para a data
// escolhida, consultando o Worker, que verifica a capacidade já comprometida em "Calendário Base"
// contra o limite cadastrado em "Limites". Slots cheios ficam desabilitados com aviso "Horário cheio".
let _horariosIndisponiveis=new Set();
// Pra HOJE, o worker já filtra os slots antes de agora+1h (arredondado pra próxima meia hora)
// e devolve 'minHoje' (string "HH:MM" ou null) + 'esgotadoHoje' (bool). O front gera a lista de
// slots localmente (gerarSlotsHorario), então precisa aplicar a MESMA regra aqui também —
// senão continua oferecendo horário passado quando o worker não respondeu a tempo.
let _minHojeAtual=null;
let _esgotadoHojeAtual=false;
function gerarSlotsHorario(){
  const slots=[];
  for(let h=8;h<=19;h++){
    for(let m=0;m<60;m+=15){
      if(h===19&&m>0)break;
      slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return slots;
}
function _dataHojeStr(){
  const now=new Date();
  const pad=n=>String(n).padStart(2,'0');
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}
// agora+1h, arredondado pra cima pra próxima meia hora (fuso do navegador). null = já passou
// do horário de atendimento (19:00) — dia esgotado por horário, mesmo sem o worker confirmar.
function _calcMinHorarioHojeStr(){
  const d=new Date(Date.now()+60*60*1000);
  let h=d.getHours(),m=d.getMinutes();
  const resto=m%30;
  if(resto!==0){ m=m-resto+30; if(m===60){m=0;h+=1;} }
  if(h>19||(h===19&&m>0))return null;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
async function carregarHorarios(dataStr){
  const horaEl=document.getElementById('f-hora');
  const statusEl=document.getElementById('f-hora-status');
  const esgotadoEl=document.getElementById('f-hora-esgotado');
  if(!horaEl)return;
  _horariosIndisponiveis=new Set();
  _minHojeAtual=null;
  _esgotadoHojeAtual=false;
  if(esgotadoEl)esgotadoEl.style.display='none';
  if(!dataStr){
    horaEl.innerHTML='<option value="">Selecione uma data primeiro</option>';
    horaEl.disabled=true;
    if(statusEl)statusEl.textContent='';
    return;
  }
  if(new Date(dataStr+'T00:00:00').getDay()===0){
    horaEl.innerHTML='<option value="">Não atendemos aos domingos</option>';
    horaEl.disabled=true;
    if(statusEl)statusEl.textContent='Não atendemos aos domingos — escolha outro dia.';
    return;
  }
  horaEl.disabled=true;
  horaEl.innerHTML='<option value="">Carregando horários...</option>';
  if(statusEl)statusEl.textContent='';
  const ehHoje=dataStr===_dataHojeStr();
  let slots=gerarSlotsHorario();
  const cheios={};
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/horarios-disponiveis?data=${encodeURIComponent(dataStr)}`);
    if(res.ok){
      const json=await res.json();
      (json.slots||[]).forEach(s=>{ if(s.cheio) cheios[s.hora]=true; });
      if(ehHoje){
        _minHojeAtual=json.minHoje||null;
        _esgotadoHojeAtual=!!json.esgotadoHoje;
      }
    }
  }catch(e){
    console.warn('Não foi possível verificar disponibilidade de horários:',e);
  }
  if(ehHoje){
    const minLocal=_calcMinHorarioHojeStr();
    if(!_minHojeAtual)_minHojeAtual=minLocal;
    if(minLocal===null)_esgotadoHojeAtual=true;
    const limite=_minHojeAtual||minLocal;
    slots=limite?slots.filter(h=>h>=limite):[];
    if(!slots.length)_esgotadoHojeAtual=true;
  }
  if(ehHoje&&_esgotadoHojeAtual){
    horaEl.innerHTML='<option value="">Sem horários disponíveis hoje</option>';
    horaEl.disabled=true;
    if(statusEl)statusEl.textContent='';
    if(esgotadoEl)esgotadoEl.style.display='block';
    return;
  }
  horaEl.innerHTML='<option value="">Selecione um horário</option>'+slots.map(h=>{
    const cheio=!!cheios[h];
    if(cheio)_horariosIndisponiveis.add(h);
    return `<option value="${h}"${cheio?' disabled':''}>${h}${cheio?' — Horário cheio':''}</option>`;
  }).join('');
  horaEl.disabled=false;
  if(statusEl)statusEl.textContent=Object.keys(cheios).length?'Alguns horários estão cheios e não podem ser selecionados — escolha outro horário disponível.':(ehHoje&&_minHojeAtual?`Pra hoje, conseguimos a partir das ${_minHojeAtual} ⏰`:'');
}
// 'skipHora' pula a validação do campo de horário — usado pelo fluxo "Falar com atendente"
// (dia esgotado hoje: não existe horário válido pra escolher, mas o resto do form precisa
// estar completo do mesmo jeito que no envio normal).
function validate(skipHora){
  let ok=true;
  let firstErrorEl=null;
  const markError=(rowEl,hasError)=>{
    if(!rowEl)return;
    if(hasError){
      rowEl.classList.add('error');
      if(!firstErrorEl)firstErrorEl=rowEl;
    }else{
      rowEl.classList.remove('error');
    }
  };
  [['frow-nome','f-nome'],['frow-tel','f-tel']].forEach(([row,field])=>{
    const el=document.getElementById(field),rowEl=document.getElementById(row);
    const invalido=!el||!el.value.trim();
    markError(rowEl,invalido);
    if(invalido)ok=false;
  });
  if(getRadio('rg-entrega')==='Entrega em endereço'){
    [['frow-cep','f-cep'],['frow-num','f-num'],['frow-rua','f-rua'],['frow-bairro','f-bairro']].forEach(([row,field])=>{
      const el=document.getElementById(field),rowEl=document.getElementById(row);
      const invalido=!el||!el.value.trim();
      markError(rowEl,invalido);
      if(invalido)ok=false;
    });
  }
  // Horário desejado: obrigatório e somente entre 08:00 e 19:00
  const horaRow=document.getElementById('frow-hora');
  const horaEl=document.getElementById('f-hora');
  const horaMsgEl=horaRow?horaRow.querySelector('.form-error-msg'):null;
  const horaVal=horaEl?horaEl.value:'';
  const dataValChk=document.getElementById('f-data')?document.getElementById('f-data').value:'';
  const ehDomingo=dataValChk&&new Date(dataValChk+'T00:00:00').getDay()===0;
  const ehHojeChk=dataValChk&&dataValChk===_dataHojeStr();
  if(skipHora){
    if(horaMsgEl)horaMsgEl.textContent='';
    markError(horaRow,false);
  }else{
    let horaInvalida=false,horaMsg='';
    if(ehDomingo){
      horaInvalida=true;
      horaMsg='Não atendemos aos domingos — escolha outro dia';
    }else if(ehHojeChk&&_esgotadoHojeAtual){
      horaInvalida=true;
      horaMsg='Não conseguimos mais encomendas pra hoje 😔';
    }else if(!horaVal){
      horaInvalida=true;
      horaMsg='Selecione um horário desejado entre 08:00 e 19:00';
    }else if(_horariosIndisponiveis.has(horaVal)){
      horaInvalida=true;
      horaMsg='Esse horário ficou cheio — selecione outro horário disponível';
    }else if(ehHojeChk&&_minHojeAtual&&horaVal<_minHojeAtual){
      horaInvalida=true;
      horaMsg=`Pra hoje, conseguimos a partir das ${_minHojeAtual} ⏰`;
    }
    if(horaMsgEl)horaMsgEl.textContent=horaMsg;
    markError(horaRow,horaInvalida);
    if(horaInvalida)ok=false;
  }

  // Valor de entrada: obrigatório escolher — EXCETO quando paga em Dinheiro (nesse caso a
  // seção fica escondida e o cliente paga tudo na retirada, sem cobrança online).
  const entradaRow=document.getElementById('row-entrada');
  if(getRadio('rg-pgto')==='Dinheiro'){
    markError(entradaRow,false);
  }else{
    const entradaPctVal=document.getElementById('f-entrada-pct')?.value||'';
    const entradaInvalida=entradaPctVal!=='50'&&entradaPctVal!=='100';
    markError(entradaRow,entradaInvalida);
    if(entradaInvalida)ok=false;
  }

  if(firstErrorEl){
    firstErrorEl.scrollIntoView({behavior:'smooth',block:'center'});
    const campo=firstErrorEl.querySelector('input,select,textarea');
    if(campo)campo.focus({preventScroll:true});
  }
  return ok;
}
let _enviandoPedido=false;

function updateTelStatus(){
  const inp=document.getElementById('f-tel');
  const st=document.getElementById('tel-status');
  if(!inp||!st)return;
  const digits=inp.value.replace(/\D/g,'');
  if(digits.length===10||digits.length===11){st.textContent='✅';}
  else if(digits.length>0){st.textContent='❌';}
  else{st.textContent='';}
}
let _pendingFinalizar=false;
function showConfirmPhone(){
  const tel=document.getElementById('f-tel')?.value||'';
  document.getElementById('confirm-phone-display').textContent=tel;
  document.getElementById('confirm-phone-overlay').classList.add('open');
}
function closeConfirmPhone(){
  document.getElementById('confirm-phone-overlay').classList.remove('open');
  _pendingFinalizar=false;
  // Focus back on the phone field
  setTimeout(()=>document.getElementById('f-tel')?.focus(),100);
}
function confirmPhoneAndSend(){
  document.getElementById('confirm-phone-overlay').classList.remove('open');
  _pendingFinalizar=false;
  _doFinalizar();
}

async function finalizar(){
  if(!validate())return;
  _pedidoParaAtendenteFlow=false; // garante que o envio normal nunca herde a flag do fluxo "Falar com atendente"
  showConfirmPhone();
  return;
}
// Dia esgotado hoje (ver f-hora-esgotado): não existe horário válido pra escolher, então o
// checkout inteiro (exceto hora) precisa estar completo e válido antes de liberar o pedido.
// Reaproveita o mesmo fluxo de confirmação de telefone + envio do "Enviar Pedido" normal —
// só marca _pedidoParaAtendenteFlow pra _doFinalizar saber que deve mandar statusInicial
// 'Para ver' e, no sucesso, ir direto pro WhatsApp (em vez de abrir o bot de status).
let _pedidoParaAtendenteFlow=false;
function falarComAtendenteEsgotado(){
  if(!validate(true))return;
  _pedidoParaAtendenteFlow=true;
  showConfirmPhone();
}
let _pedidoPendente=null; // dados do pedido aguardando confirmação no Coda (usado por retry/skip)
let _confirmandoPedido=false;

// Redimensiona a foto de referência do topper (canvas, máx. 1280px / JPEG 82%) e sobe
// pro Google Drive via worker — devolve a URL pública de visualização.
async function uploadFotoTopperDrive(prodId,file){
  const MAX_DIM=1280,QUALITY=0.82;
  const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
  const img=await new Promise((resolve,reject)=>{
    const im=new Image();
    im.onload=()=>resolve(im);
    im.onerror=reject;
    im.src=dataUrl;
  });
  let w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
  if(w>MAX_DIM||h>MAX_DIM){
    if(w>=h){h=Math.round(h*MAX_DIM/w);w=MAX_DIM;}
    else{w=Math.round(w*MAX_DIM/h);h=MAX_DIM;}
  }
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  canvas.getContext('2d').drawImage(img,0,0,w,h);
  const base64=canvas.toDataURL('image/jpeg',QUALITY).split(',')[1];

  const res=await fetch(`${CONFIG.WORKER_URL}/upload-topper-imagem`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({imagemBase64:base64,mimeType:'image/jpeg',filename:`topper_${prodId}_${Date.now()}.jpg`})
  });
  const data=await res.json();
  if(!data.ok||!data.url)throw new Error(data.error||'upload falhou');
  return data.url;
}

async function _doFinalizar(){
  // Proteção contra envio duplicado
  if(_enviandoPedido)return;
  const items=Object.values(cart).filter(i=>i.qty>0);if(!items.length)return;
  _enviandoPedido=true;
  const btnEnviar=document.querySelector('.btn-wpp');
  const btnHtmlOriginal=btnEnviar?btnEnviar.innerHTML:'';
  if(btnEnviar){btnEnviar.disabled=true;btnEnviar.classList.add('btn-sending');btnEnviar.innerHTML='⏳ Enviando pedido...';}
  // Tela de carregamento aparece já no clique — só sai dela quando o pedido
  // tiver percorrido todo o caminho necessário (Coda) e então vai para o WhatsApp.
  abrirPedidoLoading();
  try{
    saveUserData();
    const nome=document.getElementById('f-nome').value.trim(),tel=document.getElementById('f-tel').value.trim(),entrega=getRadio('rg-entrega');
    const cep=document.getElementById('f-cep')?.value.trim()||'';
    const rua=document.getElementById('f-rua')?.value.trim()||'';
    const num=document.getElementById('f-num')?.value.trim()||'';
    const bairro=document.getElementById('f-bairro')?.value.trim()||'';
    const endereco=entrega==='Entrega em endereço'?[rua,num,bairro,cep].filter(Boolean).join(', '):'';
    const pagamento=getRadio('rg-pgto'),data=document.getElementById('f-data').value,obs=document.getElementById('f-obs').value.trim();
    const topperBonus=Object.values(cart).filter(i=>topperPorProduto[i.id]?.quero).length*20;
    const taxaFrete=(getRadio('rg-entrega')==='Entrega em endereço'?(_taxaEntregaAtual||0):0);
    const total=items.reduce((s,i)=>s+i.valorUnit*i.qty,0)+topperBonus+taxaFrete;
    // Dinheiro paga tudo na retirada (entrada 0, restante = total). Sem fallback pra 50%:
    // se por algum motivo chegou vazio aqui (validação deveria ter barrado), vira 0 —
    // nunca vira silenciosamente 50%.
    const entradaPct=pagamento==='Dinheiro'?0:(parseInt(document.getElementById('f-entrada-pct')?.value||0,10)/100);
    const entradaVal=Math.round(total*entradaPct*100)/100;
    const restoVal=Math.round((total-entradaVal)*100)/100;
    const horaVal=document.getElementById('f-hora')?.value||'';

    // Monta mensagem WhatsApp
    let msg=`🛍️ *NOVO PEDIDO — D'Luh Festas*\n\n👤 *Cliente:* ${nome}\n📱 *WhatsApp:* ${tel}\n📦 *Entrega:* ${entrega==='Entrega em endereço'?`Entrega — ${endereco}`:'Retirada no local'}\n💳 *Pagamento:* ${pagamento}\n`;
    if(data)msg+=`📅 *Data:* ${data.split('-').reverse().join('/')}${horaVal?' às '+horaVal:''}\n`;
    msg+=`\n📋 *Itens:*\n`;
    items.forEach(i=>{
      msg+=`  • ${i.nome} — ${i.qty} unid. = ${fmtBRL(i.valorUnit*i.qty)}\n`;
      if((isBolo(i.tipo)||isPacote(i.tipo))&&i.recheios){const rotulo=isBolo(i.tipo)?'Bolo':'Pacote';i.recheios.forEach((r,idx)=>{msg+=`    ${rotulo} ${idx+1}: ${r.length?r.join(' + '):'sem recheio'}\n`;});}
    });
    if(topperBonus>0)msg+=`\n  • Topper personalizado (${Object.values(cart).filter(i=>topperPorProduto[i.id]?.quero).length}x) = ${fmtBRL(topperBonus)}`;
    if(taxaFrete>0)msg+=`\n  • Taxa de entrega = ${fmtBRL(taxaFrete)}`;
    msg+=`\n💰 *Total:* ${fmtBRL(total)}`;
    msg+=`\n💵 *Entrada (${Math.round(entradaPct*100)}%):* ${fmtBRL(entradaVal)}`;
    if(restoVal>0)msg+=`\n⏳ *Restante na entrega:* ${fmtBRL(restoVal)}`;
    if(obs)msg+=`\n\n📝 *Obs:* ${obs}`;
    const waUrl=`https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(msg)}`;

    // Sobe a foto de referência do topper (se o cliente anexou) ANTES de montar
    // as subrows — assim o link do Drive já entra pronto na coluna "Topo Info"
    // do Coda, e por consequência aparece também no Telegram e no admin.
    // Se o upload falhar, segue o pedido sem a imagem (não bloqueia o cliente).
    const itensComFotoTopper=items.filter(i=>isBolo(i.tipo)&&topperPorProduto[i.id]?.quero&&topperPorProduto[i.id].refFile&&!topperPorProduto[i.id].refUrl);
    if(itensComFotoTopper.length){
      setPedidoLoadingState('uploading');
      for(const i of itensComFotoTopper){
        const td=topperPorProduto[i.id];
        try{ td.refUrl=await uploadFotoTopperDrive(i.id,td.refFile); }
        catch(e){ console.warn('Falha ao subir imagem do topper:',e); }
      }
      setPedidoLoadingState('loading');
    }

    // ── MONTA DADOS PARA O CODA (síncrono, sem await) ──
    const paiCells=[
      {column:'Cliente',value:nome},
      {column:'WhatsApp',value:tel},
      {column:'Total',value:total},
      {column:'Entrega',value:entrega},
      {column:'Endereço',value:endereco},
      {column:'Pagamento',value:pagamento},
      {column:'Data Desejada',value:data},
      {column:'Hora',value:horaVal},
      {column:'Observações',value:obs},
      {column:'Entrada',value:entradaVal},
      {column:'Restante',value:restoVal},
    ];
    const subrowInputs=items.map(i=>{
      const rotuloRecheio=isBolo(i.tipo)?'Bolo':'Pacote';
      const recheiosTxt=((isBolo(i.tipo)||isPacote(i.tipo))&&i.recheios)?i.recheios.map((r,idx)=>`${rotuloRecheio} ${idx+1}: ${Array.isArray(r)?r.join(' + '):r||'sem recheio'}`).join(' | '):'';
      return [
        {column:'Produto',value:i.nome},
        {column:'Row ID Produto',value:i.id},
        {column:'Quantidade',value:i.qty},
        {column:'Valor Unit',value:i.valorUnit},
        {column:'Recheios',value:recheiosTxt},
        {column:'Cliente',value:nome},
        {column:'WhatsApp',value:tel},
        {column:'Entrega',value:entrega},
        {column:'Pagamento',value:pagamento},
        {column:'Entrada',value:entradaVal},
        {column:'Restante',value:restoVal},
        {column:'Data Desejada',value:data},
        {column:'Hora',value:horaVal},
        {column:'Observações',value:obs},
      ];
    });
    // Topper personalizado vira uma subrow própria (filha do mesmo pedido pai),
    // assim aparece junto com os outros itens no Coda, no admin e no Telegram —
    // mesmo padrão já usado para "🛵 Taxa de Entrega".
    items.forEach(i=>{
      const td=topperPorProduto[i.id];
      if(!(isBolo(i.tipo)&&td?.quero))return;
      const topperTxt=`Tema: ${td.tema}${td.detalhes?'\nDetalhes: '+td.detalhes:''}${td.refUrl?'\nReferência: '+td.refUrl:''}`;
      subrowInputs.push([
        {column:'Produto',value:`🎀 Topper — ${i.nome}`},
        {column:'Row ID Produto',value:i.id},
        {column:'Quantidade',value:1},
        {column:'Valor Unit',value:20},
        {column:'Cliente',value:nome},
        {column:'WhatsApp',value:tel},
        {column:'Entrega',value:entrega},
        {column:'Pagamento',value:pagamento},
        {column:'Entrada',value:entradaVal},
        {column:'Restante',value:restoVal},
        {column:'Data Desejada',value:data},
        {column:'Hora',value:horaVal},
        {column:'Topo Info',value:topperTxt},
        {column:'Referencia',value:td.refUrl||''},
      ]);
    });

    const itensTexto=items.map(i=>{
      let txt=`${i.nome} · ${i.qty} unid. = R$ ${(i.valorUnit*i.qty).toFixed(2)}`;
      if((isBolo(i.tipo)||isPacote(i.tipo))&&i.recheios){const rotulo=isBolo(i.tipo)?'Bolo':'Pacote';i.recheios.forEach((r,idx)=>{txt+=`\n  ${rotulo} ${idx+1}: ${r.length?r.join(' + '):'sem recheio'}`;});}
      return txt;
    }).join('\n');

    // Guarda os dados montados — usados pela confirmação (e por retry/skip se algo falhar)
    // 'msg' (resumo formatado p/ WhatsApp) é reaproveitado pelo bot pra postar o mesmo
    // resumo dentro do próprio chat, ver abrirStatusBotPosPedido() (seção 2.5).
    // '_editData' existe quando o cliente está editando um pedido já existente
    // (chave 'dluh_edit_pedido' no localStorage, gravada pelo painel "Meus Pedidos").
    const _editData=(()=>{try{const s=localStorage.getItem('dluh_edit_pedido');return s?JSON.parse(s):null;}catch(_){return null;}})();
    // statusInicial:'Para ver' identifica o fluxo de dia esgotado (botão "Falar com atendente")
    // — captura a flag aqui e já reseta o módulo pra não vazar pro próximo pedido.
    const statusInicial=_pedidoParaAtendenteFlow?'Para ver':undefined;
    _pedidoParaAtendenteFlow=false;
    _pedidoPendente={paiCells,subrowInputs,taxaFrete,waUrl,msg,nome,tel,entrega,endereco,pagamento,data,horaVal,obs,total,entradaVal,restoVal,itensTexto,items,_editData,statusInicial};

    // Só passa para o WhatsApp depois que o pedido for registrado no Coda
    await _confirmarESeguirWhats();
  }catch(e){
    console.warn('Erro ao preparar pedido:',e);
    setPedidoLoadingState('error');
  }finally{
    _enviandoPedido=false;
    if(btnEnviar){btnEnviar.disabled=false;btnEnviar.classList.remove('btn-sending');btnEnviar.innerHTML=btnHtmlOriginal;}
  }
}

// Envia o pedido para o Coda e só então segue para o fluxo pós-pedido.
// Em modo edição usa /editar-pedido; no fluxo normal usa /novo-pedido.
// Pode ser chamada de novo pelo botão "Tentar novamente" no overlay de erro.
async function _confirmarESeguirWhats(){
  const p=_pedidoPendente;
  if(!p||_confirmandoPedido)return;
  _confirmandoPedido=true;
  setPedidoLoadingState('loading');
  const isEdit=!!(p._editData&&p._editData.paiId);
  try{
    const ctrl=new AbortController();
    const timeoutId=setTimeout(()=>ctrl.abort(),15000);
    let res,d;
    try{
      if(isEdit){
        res=await fetch(`${CONFIG.WORKER_URL}/editar-pedido`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({paiId:p._editData.paiId,pai:p.paiCells,subrows:p.subrowInputs,taxaFrete:p.taxaFrete}),
          signal:ctrl.signal
        });
      }else{
        res=await fetch(`${CONFIG.WORKER_URL}/novo-pedido`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({pai:p.paiCells,subrows:p.subrowInputs,taxaFrete:p.taxaFrete,...(p.statusInicial?{statusInicial:p.statusInicial}:{})}),
          signal:ctrl.signal
        });
      }
    }finally{ clearTimeout(timeoutId); }
    d=await res.json().catch(()=>({}));
    if(!res.ok||!d||d.ok===false) throw new Error((d&&d.error)?d.error:'Falha ao registrar pedido no Coda');

    if(isEdit){
      // ── Modo edição ──
      localStorage.removeItem('dluh_edit_pedido');
      try{document.getElementById('coda-note').textContent='✅ Pedido atualizado!';}catch(_){}
      setPedidoLoadingState('success');
      clearCart();topperPorProduto={};
      _pedidoPendente=null;
      if((d.reembolso||0)>0){
        // Novo total ficou menor que o valor já pago — exibe modal de reembolso
        setTimeout(()=>abrirModalReembolso(d),700);
      }else{
        setTimeout(()=>{ fecharPedidoLoading(); showToast('Pedido editado com sucesso! ✅'); },700);
      }
    }else{
      // ── Fluxo normal (novo pedido) ──
      p.paiId=d.paiId||null; // ID (Coda) do pedido recém-criado — usado pra rastrear ESSE pedido no acompanhamento pós-pedido
      try{document.getElementById('coda-note').textContent='✅ Pedido registrado!';}catch(_){}
      // Extras não-críticos: não atrasam a abertura do chat, só disparam depois que o essencial confirmou
      salvarPedidoFirebase({nome:p.nome,tel:p.tel,entrega:p.entrega,endereco:p.endereco,pagamento:p.pagamento,data:p.data,hora:p.horaVal,obs:p.obs,total:p.total,entradaVal:p.entradaVal,restoVal:p.restoVal,itensTexto:p.itensTexto});
      // (a foto de referência do topper, se houver, já foi enviada ao Drive antes
      // de montar as subrows — o link está em topperPorProduto[id].refUrl / na subrow)
      setPedidoLoadingState('success');
      clearCart();topperPorProduto={};
      _pedidoPendente=null;
      if(p.statusInicial!=='Para ver'){
        // Pós-pedido: vai DIRETO pro WhatsApp da empresa (sem texto pré-preenchido —
        // decisão de 2026-07: o bot de WhatsApp da loja assume o atendimento a partir
        // daqui; o acompanhamento no chat do site foi aposentado neste fluxo).
        setTimeout(()=>irParaWhatsapp(`https://wa.me/${CONFIG.WHATSAPP}`),700);
      }else{
        // Dia esgotado (fluxo "Falar com atendente"): vai direto pro WhatsApp com o
        // resumo do pedido já montado.
        setTimeout(()=>irParaWhatsapp(p.waUrl),700);
      }
    }
  }catch(e){
    console.warn('Erro ao confirmar pedido no Coda:',e);
    setPedidoLoadingState('error');
  }finally{
    _confirmandoPedido=false;
  }
}

function irParaWhatsapp(waUrl){
  fecharPedidoLoading();
  let opened=false;
  try{ const w=window.open(waUrl,'_blank'); opened=!!(w&&!w.closed); }catch(_){}
  if(!opened){ window.location.href=waUrl; }
}

function _retryEnvioPedido(){ _confirmarESeguirWhats(); }
function _skipParaWhatsapp(){
  if(!_pedidoPendente)return;
  const waUrl=_pedidoPendente.waUrl;
  clearCart();topperPorProduto={};
  _pedidoPendente=null;
  irParaWhatsapp(waUrl);
}

// ── Modal de reembolso (edição de pedido com novo total menor que o pago) ──
function abrirModalReembolso(d){
  fecharPedidoLoading();
  const valorPago=d.valorPago||0;
  const novoTotal=d.novoTotal||0;
  const reembolso=d.reembolso||0;
  const txt=encodeURIComponent(`Olá! Editei meu pedido e o novo total ficou ${fmtBRL(novoTotal)}. Como já paguei ${fmtBRL(valorPago)}, tenho um reembolso de ${fmtBRL(reembolso)}. Pode me reembolsar? 😊`);
  const waUrl=`https://wa.me/${CONFIG.WHATSAPP}?text=${txt}`;
  const existing=document.getElementById('reembolso-modal-overlay');
  if(existing)existing.remove();
  const el=document.createElement('div');
  el.id='reembolso-modal-overlay';
  el.className='reembolso-modal-overlay open';
  el.innerHTML=`
    <div class="reembolso-modal-box">
      <div class="reembolso-modal-icon">🎉</div>
      <div class="reembolso-modal-title">Pedido atualizado!</div>
      <div class="reembolso-modal-sub">Seu novo total ficou menor que o valor já pago.</div>
      <div class="reembolso-modal-rows">
        <div class="reembolso-modal-row"><span>Valor pago anteriormente</span><span>${fmtBRL(valorPago)}</span></div>
        <div class="reembolso-modal-row"><span>Novo total</span><span>${fmtBRL(novoTotal)}</span></div>
        <div class="reembolso-modal-row reembolso-modal-row--destaque"><span>Reembolso</span><span>${fmtBRL(reembolso)}</span></div>
      </div>
      <p class="reembolso-modal-info">Clique abaixo para avisar a D'Luh e solicitar o reembolso pelo WhatsApp</p>
      <a href="${waUrl}" target="_blank" rel="noopener" class="reembolso-btn-wpp">💰 Solicitar Reembolso pelo WhatsApp</a>
      <button class="reembolso-btn-fechar" onclick="fecharModalReembolso()">Fechar</button>
    </div>`;
  document.body.appendChild(el);
}
function fecharModalReembolso(){
  const el=document.getElementById('reembolso-modal-overlay');
  if(el)el.remove();
}

// ── Overlay de carregamento do pedido ──
function abrirPedidoLoading(){
  document.getElementById('pedido-loading-overlay').classList.add('open');
  setPedidoLoadingState('loading');
}
function fecharPedidoLoading(){
  document.getElementById('pedido-loading-overlay').classList.remove('open');
}
function setPedidoLoadingState(state){
  const spinner=document.getElementById('pl-spinner');
  const icon=document.getElementById('pl-icon');
  const title=document.getElementById('pl-title');
  const sub=document.getElementById('pl-sub');
  const actions=document.getElementById('pl-actions');
  if(!spinner||!icon||!title||!sub||!actions)return;
  if(state==='loading'){
    spinner.style.display='block';icon.style.display='none';actions.style.display='none';
    title.textContent='Confirmando seu pedido...';
    sub.textContent='Aguarde um instante, não feche nem saia desta página';
  }else if(state==='uploading'){
    spinner.style.display='block';icon.style.display='none';actions.style.display='none';
    title.textContent='Enviando a foto do topper...';
    sub.textContent='Aguarde um instante, não feche nem saia desta página';
  }else if(state==='success'){
    spinner.style.display='none';icon.style.display='block';icon.textContent='✅';actions.style.display='none';
    title.textContent='Pedido confirmado!';
    sub.textContent='Abrindo seu chat de acompanhamento...';
  }else if(state==='error'){
    spinner.style.display='none';icon.style.display='block';icon.textContent='⚠️';actions.style.display='flex';
    title.textContent='Não foi possível confirmar';
    sub.textContent='Seu pedido pode não ter sido registrado. Tente novamente ou continue para o WhatsApp.';
  }
}

// ── TABELA DE TAXA DE ENTREGA (Moblets) ──────────────────────
const ENTREGA_CONFIG = {
  LAT_LOJA: -16.7286406,  // Rua Visconde de Taunay 278, Vila Maria Cândida, Montes Claros
  LNG_LOJA: -43.8582139,
  FATOR_ROTA: 1.80,    // Fator calibrado com rota real Montes Claros (2.33km linha × 1.80 = 4.19km rota)
  TABELA: [
    { ate: 2.00,  valor: 6.60  },
    { ate: 3.00,  valor: 7.80  },
    { ate: 4.00,  valor: 9.70  },
    { ate: 5.00,  valor: 10.80 },
    { ate: 6.50,  valor: 11.90 },
    { ate: 8.00,  valor: 13.10 },
    { ate: 9.00,  valor: 14.50 },
    { ate: 10.00, valor: 16.90 },
    { ate: 11.00, valor: 18.50 },
    { ate: 13.00, valor: 19.90 },
    { ate: 15.00, valor: 21.00 },
    { ate: 17.00, valor: 22.70 },
    { ate: 19.00, valor: 25.90 },
    { ate: 22.00, valor: 28.50 },
    { ate: 50.00, valor: 50.00 },
    { ate: 60.00, valor: 60.00 },
    { ate: 70.00, valor: 70.00 },
    { ate: 80.00, valor: 80.00 },
    { ate: 90.00, valor: 90.00 },
    { ate: 100.00,valor: 100.00},
  ],
};
function taxaPorKm(km) {
  for (const faixa of ENTREGA_CONFIG.TABELA) {
    if (km <= faixa.ate) return faixa.valor;
  }
  return ENTREGA_CONFIG.TABELA.at(-1).valor;
}
// ─────────────────────────────────────────────────────────────

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let _taxaEntregaAtual = 0;

// Chave OpenCage (geocodificador gratuito, sem cartão — opencagedata.com)
const OPENCAGE_API_KEY = 'd1b604a636d74015b0975bcc0dab85d2';

// ── TABELA MANUAL DE CEPs ────────────────────────────────────────
// CEPs com valores verificados manualmente. Prioridade MÁXIMA.
const CEP_PRECOS_FIXOS = {};
// ─────────────────────────────────────────────────────────────────

// ── TABELA DE PREÇOS POR BAIRRO ──────────────────────────────────
// Gerado automaticamente via API Lets Express / Moblets em junho/2025.
// Chave: nome do bairro conforme retornado pela BrasilAPI (normalizado).
const BAIRRO_PRECOS = {
  'Acácias': 13.10, 'Alcides Rabelo': 13.10, 'Alice Maia': 13.10,
  'Alterosas': 7.80, 'Alto da Boa Vista': 7.80, 'Alto Floresta': 14.50,
  'Alto São João': 11.90, 'Amazonas': 13.10, 'Antônio Pimenta': 6.60,
  'Augusta Mota': 14.50, 'Barcelona Park': 13.10, 'Barreiro': 9.70,
  'Bela Vista': 13.10, 'Belvedere': 11.90, 'Camilo Prates': 10.80,
  'Cândida Câmara': 10.80, 'Canelas': 9.70, 'Carmelo': 11.90,
  'Centro': 10.80, 'Cidade Industrial': 19.90, 'Cidade Nova': 7.80,
  'Cidade Santa Maria': 9.70, 'Cintra': 9.70, 'Clarindo Lopes': 7.80,
  'Colorado': 9.70, 'Conjunto Cristo Rei': 6.60, 'Conjunto Havaí': 7.80,
  'Conjunto Joaquim Costa': 7.80, 'Delfino Magalhães': 9.70,
  'Dona Gregória': 7.80, 'Duque de Caxias': 9.70, 'Edgar Pereira': 13.10,
  'Eldorado': 16.90, 'Esplanada': 11.90, 'Funcionários': 9.70,
  'Guarujá': 13.10, 'Ibituruna': 13.10, 'Inconfidentes': 9.70,
  'Independência': 13.10, 'Interlagos': 11.90, 'Ipiranga': 16.90,
  'Jaraguá': 18.50, 'Jardim Alvorada': 7.80, 'Jardim Brasil': 13.10,
  'Jardim Liberdade': 13.10, 'Jardim Olímpico': 10.80,
  'Jardim São Luiz': 10.80, 'João Botelho': 7.80,
  'José Carlos Vale de Lima': 6.60, 'Juscelino Kubitschek': 9.70,
  'Lourdes': 10.80, 'Major Prates': 10.80, 'Maracanã': 7.80,
  'Melo': 11.90, 'Monte Alegre': 9.70, 'Morada da Serra': 11.90,
  'Morada do Parque': 11.90, 'Morada do Sol': 10.80, 'Morrinhos': 9.70,
  'Nossa Senhora Aparecida': 13.10, 'Nossa Senhora das Graças': 7.80,
  'Nossa Senhora de Fátima': 7.80, 'Nova América': 19.90,
  'Nova Morada': 14.50, 'Nova Suíça': 13.10, 'Novo Delfino': 10.80,
  'Panorama': 13.10, 'Planalto': 13.10, 'Regina Peres': 9.70,
  'Renascença': 13.10, 'Sagrada Família': 9.70, 'Santa Cecília': 13.10,
  'Santa Eugênia': 14.50, 'Santa Lúcia': 9.70, 'Santa Rita': 7.80,
  'Santo Amaro': 10.80, 'Santo Antônio': 7.80, 'Santos Dumont': 10.80,
  'São Geraldo': 16.90, 'São João': 11.90, 'São Judas Tadeu': 6.60,
  'São Lucas': 11.90, 'São Mateus': 13.10, 'Tancredo Neves': 13.10,
  'Todos os Santos': 11.90, 'Universitário': 16.90, 'Vargem Grande': 9.70,
  'Vera Cruz': 11.90, 'Vila Anália': 10.80, 'Vila Atlântida': 13.10,
  'Vila Brasília': 11.90, 'Vila Campos': 7.80, 'Vila Castelo Branco': 16.90,
  'Vila Guilhermina': 9.70, 'Vila Maria Cândida': 6.60,
  'Vila Mauricéia': 11.90, 'Vila Oliveira': 13.10, 'Vila Real': 13.10,
  'Vila Regina': 11.90, 'Vila Santa Cruz': 11.90, 'Vila Sion': 7.80,
  'Vila Sumaré': 6.60, 'Vila Telma': 6.60, 'Vila Tiradentes': 10.80,
  'Village do Lago': 19.90,
};

// Normaliza nome de bairro para comparação (sem acento, lowercase, trim)
function normalizarBairro(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

// Mapa normalizado para lookup rápido
const _BAIRRO_NORM = Object.fromEntries(
  Object.entries(BAIRRO_PRECOS).map(([k, v]) => [normalizarBairro(k), v])
);
// ─────────────────────────────────────────────────────────────────

async function geocodeHere(street, neighborhood, city, state) {
  if (!OPENCAGE_API_KEY) throw new Error('sem chave OpenCage');
  const q = [street, neighborhood, city, state, 'Brasil'].filter(Boolean).join(', ');
  const r = await fetch(`https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(q)}&countrycode=br&limit=1&key=${OPENCAGE_API_KEY}`);
  const d = await r.json();
  const geo = d?.results?.[0]?.geometry;
  if (!geo?.lat) throw new Error('OpenCage sem resultado');
  return { lat: geo.lat, lng: geo.lng, confiavel: true };
}

async function geocodeFallback(street, neighborhood, city, state) {
  // AwesomeAPI — tem lat/lng para a maioria dos CEPs BR
  // (chamada feita pelo CEP principal, não aqui direto)
  // Nominatim por BAIRRO+CIDADE — mais estável que rua
  const q = [neighborhood, city, state, 'Brasil'].filter(Boolean).join(', ');
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=br`,
    { headers: { 'Accept-Language': 'pt-BR', 'User-Agent': 'DLuhFestas/1.0' } }
  );
  const d = await r.json();
  if (!d.length) throw new Error('Nominatim sem resultado');
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), confiavel: false };
}

// Distância mínima aceitável em linha reta (km) vinda de fontes não confiáveis.
// Abaixo disso assumimos geocoding errado e exibimos "a combinar".
const DIST_MIN_SUSPEITA = 0.8;

async function calcDeliveryFee() {
  const cep = document.getElementById('f-cep')?.value.replace(/\D/g,'') || '';
  if (!cep || cep.length < 8) return;

  const box     = document.getElementById('taxa-entrega-box');
  const loading = document.getElementById('taxa-entrega-loading');
  const valEl   = document.getElementById('taxa-entrega-val');
  const infoEl  = document.getElementById('taxa-entrega-info');

  if(box) box.style.display = 'none';
  if(loading) loading.style.display = 'block';

  try {
    // 0) Tabela manual — prioridade total sobre APIs
    if (CEP_PRECOS_FIXOS[cep] !== undefined) {
      _taxaEntregaAtual = CEP_PRECOS_FIXOS[cep];
      if(valEl) valEl.textContent = fmtBRL(_taxaEntregaAtual);
      if(infoEl) infoEl.textContent = 'Taxa verificada';
      if(box) box.style.display = 'block';
      if(loading) loading.style.display = 'none';
      return;
    }

    // 1) BrasilAPI — address info + coordenadas diretas quando disponíveis
    const res  = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (!res.ok) throw new Error('CEP não encontrado');
    const data = await res.json();

    // 1b) Tabela por bairro — usa Google Maps da Lets Express (mais preciso)
    const precoBairro = _BAIRRO_NORM[normalizarBairro(data.neighborhood)];
    if (precoBairro !== undefined) {
      _taxaEntregaAtual = precoBairro;
      if(valEl) valEl.textContent = fmtBRL(_taxaEntregaAtual);
      if(infoEl) infoEl.textContent = `${data.neighborhood || 'Bairro'} — taxa verificada`;
      if(box) box.style.display = 'block';
      if(loading) loading.style.display = 'none';
      return;
    }

    let lat, lng, confiavel = false;
    const coords = data?.location?.coordinates;

    if (coords?.latitude && coords?.longitude) {
      // BrasilAPI tem coordenadas → confiável
      lat = parseFloat(coords.latitude);
      lng = parseFloat(coords.longitude);
      confiavel = true;
    } else {
      // 2) AwesomeAPI — tem lat/lng por CEP na maioria dos casos
      try {
        const r2 = await fetch(`https://cep.awesomeapi.com.br/json/${cep}`);
        const d2 = await r2.json();
        if (d2?.lat && d2?.lng && parseFloat(d2.lat) !== 0) {
          lat = parseFloat(d2.lat);
          lng = parseFloat(d2.lng);
          confiavel = false; // AwesomeAPI às vezes retorna centroide de rua errado
        } else { throw new Error('sem coords'); }
      } catch(_) {
        // 3) HERE Maps (se configurado) — mais preciso
        try {
          const geo = await geocodeHere(data.street, data.neighborhood, data.city, data.state);
          lat = geo.lat; lng = geo.lng; confiavel = true;
        } catch(__) {
          // 4) Nominatim por bairro+cidade — último recurso
          const geo = await geocodeFallback(data.street, data.neighborhood, data.city, data.state);
          lat = geo.lat; lng = geo.lng; confiavel = false;
        }
      }
    }

    const distLinha = haversineKm(ENTREGA_CONFIG.LAT_LOJA, ENTREGA_CONFIG.LNG_LOJA, lat, lng);

    // Se a fonte não é confiável e a distância é suspeita, exibe "a combinar"
    if (!confiavel && distLinha < DIST_MIN_SUSPEITA) {
      throw new Error('geocoding impreciso');
    }

    const distRota = distLinha * ENTREGA_CONFIG.FATOR_ROTA;
    const taxa = taxaPorKm(distRota);
    _taxaEntregaAtual = taxa;

    if(valEl) valEl.textContent = fmtBRL(taxa);
    if(infoEl) infoEl.textContent = `~${distRota.toFixed(1)} km de distância`;
    if(box) box.style.display = 'block';
  } catch(e) {
    _taxaEntregaAtual = 0;
    if(valEl) valEl.textContent = 'a combinar';
    if(infoEl) infoEl.textContent = 'Taxa será informada pelo atendente';
    if(box) box.style.display = 'block';
  } finally {
    if(loading) loading.style.display = 'none';
  }
}


// ─────────────────────────────────────────────────────────────


// ── Dinheiro = apenas retirada ─────────────────────────────
function forcarRetirada() {
  const opts = document.querySelectorAll('#rg-entrega .radio-opt');
  opts.forEach(o => {
    if (o.dataset.val === 'Retirada no local') {
      o.click();
    } else {
      o.style.opacity = '0.4';
      o.style.pointerEvents = 'none';
      o.title = 'Entrega não disponível para pagamento em dinheiro';
    }
  });
  const note = document.getElementById('dinheiro-note');
  if (note) note.style.display = 'block';
  // Dinheiro = paga tudo na retirada: esconde a seção de entrada e limpa a seleção
  const rowEntrada = document.getElementById('row-entrada');
  if (rowEntrada) rowEntrada.style.display = 'none';
  const fEntrada = document.getElementById('f-entrada-pct');
  if (fEntrada) fEntrada.value = '';
  document.querySelectorAll('#rg-entrada-pct .radio-opt').forEach(o => o.classList.remove('active'));
}
function liberarEntrega() {
  document.querySelectorAll('#rg-entrega .radio-opt').forEach(o => {
    o.style.opacity = '';
    o.style.pointerEvents = '';
    o.title = '';
  });
  const note = document.getElementById('dinheiro-note');
  if (note) note.style.display = 'none';
  // Volta a mostrar a seção de entrada (sem opção pré-selecionada) e recalcula
  const rowEntrada = document.getElementById('row-entrada');
  if (rowEntrada) rowEntrada.style.display = '';
  atualizarEntrada();
}
// ──────────────────────────────────────────────────────────

function onCepInput(el){
  el.value=formatCep(el.value);
  const cep=el.value.replace(/\D/g,'');
  if(cep.length===8) fetchCep(cep);
  saveUserData();
}

async function fetchCep(cep){
  const spinner=document.getElementById('cep-spinner');
  if(spinner)spinner.style.display='inline';
  try{
    const res=await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data=await res.json();
    if(data.erro){showToast('CEP não encontrado');return;}
    const setVal=(id,val,readonly=false)=>{
      const el=document.getElementById(id);
      if(el){el.value=val;if(readonly){el.readOnly=true;el.style.background='var(--surface2)';el.style.color='var(--text2)';}else{el.readOnly=false;el.style.background='';el.style.color='';}}
    };
    setVal('f-rua', data.logradouro||'', !!data.logradouro);
    setVal('f-bairro', data.bairro||'', false);
    saveUserData();
    calcDeliveryFee();
    // Foca no número após preencher
    const numEl=document.getElementById('f-num');
    if(numEl)numEl.focus();
  }catch(e){showToast('Erro ao buscar CEP');}
  finally{if(spinner)spinner.style.display='none';}
}

// ── AUTOCOMPLETE DE ENDEREÇO (Google Maps Places) ──
let autocompleteTimeout = null;
let lastPlaceResults = [];

function onEnderecoInput(){
  saveUserData();
  const val = document.getElementById('f-end').value.trim();
  clearTimeout(autocompleteTimeout);
  if(val.length < 4){ closeAutocomplete(); return; }
  autocompleteTimeout = setTimeout(()=>fetchPlaces(val), 350);
}

function onEnderecoFocus(){
  const val = document.getElementById('f-end').value.trim();
  if(val.length >= 4) fetchPlaces(val);
}

async function fetchPlaces(query){
  try{
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=5&addressdetails=1&accept-language=pt-BR`;
    const res = await fetch(url, {headers:{'Accept-Language':'pt-BR','User-Agent':'DluhFestas/1.0'}});
    if(!res.ok) return;
    const data = await res.json();
    renderAutocomplete(data);
  }catch(e){ closeAutocomplete(); }
}

function renderAutocomplete(results){
  const list = document.getElementById('end-autocomplete');
  if(!results.length){ closeAutocomplete(); return; }
  list.style.display = 'block';
  list.innerHTML = results.map((p,i)=>{
    const addr = p.address || {};
    const main = [addr.road, addr.house_number].filter(Boolean).join(', ') || p.display_name.split(',')[0];
    const sec = [addr.suburb||addr.neighbourhood, addr.city||addr.town||addr.municipality, addr.state].filter(Boolean).join(', ');
    return `<div class="autocomplete-item" onclick="selectPlace(${i})">
      <div class="autocomplete-main">${main}</div>
      ${sec?`<div class="autocomplete-sub">${sec}</div>`:''}
    </div>`;
  }).join('');
  lastPlaceResults = results;
}

function selectPlace(idx){
  const p = lastPlaceResults[idx];
  if(!p) return;
  const addr = p.address || {};
  // Monta endereço completo formatado
  const parts = [
    addr.road,
    addr.house_number,
    addr.suburb || addr.neighbourhood,
    addr.city || addr.town || addr.municipality,
    addr.state
  ].filter(Boolean);
  document.getElementById('f-end').value = parts.join(', ');
  saveUserData();
  closeAutocomplete();
}

function closeAutocomplete(){
  const list = document.getElementById('end-autocomplete');
  if(list) list.style.display = 'none';
}

// Fecha autocomplete ao clicar fora
document.addEventListener('click', e=>{
  if(!e.target.closest('#f-end') && !e.target.closest('#end-autocomplete')) closeAutocomplete();
});

// Pré-preenche data com hoje, define mínimo e carrega os horários disponíveis para a data escolhida
(function(){
  const dataEl=document.getElementById('f-data');
  const horaEl=document.getElementById('f-hora');
  if(!dataEl||!horaEl)return;
  const now=new Date();
  const pad=n=>String(n).padStart(2,'0');
  const hoje=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  dataEl.value=hoje;
  dataEl.min=hoje;
  dataEl.addEventListener('change',()=>{carregarHorarios(dataEl.value);atualizarEntrada();});
  carregarHorarios(dataEl.value);
})();

