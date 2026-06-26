// ── DADOS SALVOS DO USUÁRIO ──
const USER_KEY = 'dluh_userdata';

function saveUserData(){
  try{
    const data = {
      tel: document.getElementById('f-tel')?.value||'',
      cep: document.getElementById('f-cep')?.value||'',
      rua: document.getElementById('f-rua')?.value||'',
      num: document.getElementById('f-num')?.value||'',
      bairro: document.getElementById('f-bairro')?.value||'',
      entrega: getRadio('rg-entrega')||'',
    };
    localStorage.setItem(USER_KEY, JSON.stringify(data));
  }catch(e){}
}

function loadUserData(){
  try{
    const saved = localStorage.getItem(USER_KEY);
    if(!saved) return;
    const data = JSON.parse(saved);
    const set=(id,val)=>{const el=document.getElementById(id);if(el&&val)el.value=val;};
    set('f-tel',data.tel);if(document.getElementById('f-tel')){maskPhone(document.getElementById('f-tel'));updateTelStatus();}
    set('f-cep',data.cep);
    set('f-rua',data.rua);
    set('f-num',data.num);
    set('f-bairro',data.bairro);
    // Restaura radio de entrega e recalcula taxa se necessário
    if(data.entrega){
      const opt=document.querySelector(`#rg-entrega .radio-opt[data-val="${data.entrega}"]`);
      if(opt) selectRadio(opt,'rg-entrega');
      if(data.entrega==='Entrega em endereço' && data.cep) setTimeout(()=>calcDeliveryFee(),200);
    }
  }catch(e){}
}

// ── STATUS BAR em tempo real ──────────────────────────────────
const STATUS_STEPS = [
  'Aguardando confirmação',
  'Confirmado',
  'Em preparo',
  'Saiu para entrega',
  'Pronto para retirada',
];

let _unsubStatusBar = null;

function initStatusBar(user) {
  if (_unsubStatusBar) { _unsubStatusBar(); _unsubStatusBar = null; }
  if (!user || !window._fbWatchPedidoAtivo) {
    document.getElementById('status-bar').style.display = 'none';
    return;
  }
  _unsubStatusBar = window._fbWatchPedidoAtivo(user.uid, (pedido) => {
    const bar = document.getElementById('status-bar');
    if (!pedido) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    document.getElementById('sb-nome').textContent = pedido.nome?.split(' ')[0] || '';
    const status = pedido.status || STATUS_STEPS[0];
    const idx = STATUS_STEPS.indexOf(status);
    // Use retirada step label if not delivery
    const steps = pedido.entrega === 'Entrega em endereço' ? STATUS_STEPS : STATUS_STEPS.map(s => s === 'Saiu para entrega' ? 'Pronto para retirada' : s).filter((s,i) => i !== 4 || pedido.entrega !== 'Entrega em endereço');
    const stepsEl = document.getElementById('sb-steps');
    stepsEl.innerHTML = STATUS_STEPS
      .filter(s => !(s === 'Pronto para retirada' && pedido.entrega === 'Entrega em endereço'))
      .filter(s => !(s === 'Saiu para entrega' && pedido.entrega !== 'Entrega em endereço'))
      .map((s, i, arr) => {
        const stepIdx = STATUS_STEPS.indexOf(s);
        const cls = stepIdx < idx ? 'done' : stepIdx === idx ? 'active' : '';
        const sep = i < arr.length - 1 ? '<span class="status-step-sep">›</span>' : '';
        return `<span class="status-step ${cls}"><span class="status-step-dot"></span>${s}</span>${sep}`;
      }).join('');
  });
}

// Hook into auth change
// Nota: window._onAuthChange é reatribuído de novo mais abaixo (seção "AUTH &
// HISTÓRICO"), o que sobrescreve este wrapper — então o mpInit() do painel
// "Meus Pedidos" foi colocado direto naquela atribuição final, não aqui.
const _origOnAuth = window._onAuthChange;
window._onAuthChange = (user) => {
  if (_origOnAuth) _origOnAuth(user);
  initStatusBar(user);
};
// ── AUTH & HISTÓRICO ──
window._onAuthChange = function(user) {
  const btn = document.getElementById('auth-btn');
  if (btn) {
    if (user) {
      const parts = user.displayName.trim().split(' ');
      const shortName = parts.length >= 2 ? parts[0] + ' ' + parts[1] : parts[0];
      btn.innerHTML = `<img src="${user.photoURL}" alt="" style="width:22px;height:22px;border-radius:50%;border:1.5px solid var(--accent)"> <span class="auth-label">${shortName}</span>`;
      const fNome = document.getElementById('f-nome');
      if (fNome && !fNome.value) fNome.value = user.displayName;
    } else {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg><span class="auth-label" id="auth-label">Entrar</span>`;
    }
  }
  // Nota: a reatribuição acima de window._onAuthChange sobrescreve o wrapper
  // definido lá em cima (seção "Hook into auth change" / initStatusBar) — como
  // esta é a última atribuição no arquivo, é ela que realmente roda quando o
  // Firebase dispara onAuthStateChanged. Por isso o aviso de "Meus Pedidos"
  // (mpInit) é chamado direto aqui, não lá em cima.
  mpInit();
};


function showLoginRequired(){
  document.getElementById('login-overlay').classList.add('open');
}
function closeLoginModal(){
  document.getElementById('login-overlay').classList.remove('open');
}
async function doGoogleLogin(){
  if(!window._fbSignIn){showToast('Aguarde...');return;}
  try{
    await window._fbSignIn();
    closeLoginModal();
    // Reabre o drawer para o usuário continuar
    openDrawer();
    showToast('Login realizado! Finalize seu pedido.');
  }catch(e){
    if(e.code!=='auth/popup-closed-by-user')showToast('Erro ao entrar. Tente novamente.');
  }
}

function handleAuth() {
  if (window._fbUser) {
    openHistModal();
  } else {
    if (!window._fbSignIn) { showToast('Aguarde...'); return; }
    window._fbSignIn().catch(e => showToast('Erro ao entrar: ' + e.message));
  }
}

function openHistModal() {
  document.getElementById('hist-overlay').classList.add('open');
  renderHistBody();
}

function closeHistModal() {
  document.getElementById('hist-overlay').classList.remove('open');
}

function closeHist(e) {
  if (e.target === document.getElementById('hist-overlay')) closeHistModal();
}

async function renderHistBody(){
  const body=document.getElementById('hist-body');
  const user=window._fbUser;
  if(!user){closeHistModal();return;}
  let userData={};
  try{const s=localStorage.getItem('dluh_userdata');if(s)userData=JSON.parse(s);}catch(e){}
  body.innerHTML=`
    <div class="hist-user">
      <img class="hist-avatar" src="${user.photoURL}" alt="">
      <div style="flex:1;min-width:0">
        <div class="hist-user-name">${user.displayName}</div>
        <div class="hist-user-email">${user.email}</div>
      </div>
      <button class="hist-signout" onclick="doSignOut()">Sair</button>
    </div>
    <div class="hist-tabs">
      <button class="hist-tab active" onclick="switchTab(this,'tab-dados')">📋 Meus dados</button>
      <button class="hist-tab" onclick="switchTab(this,'tab-pedidos')">🛍️ Pedidos</button>
    </div>
    <div id="tab-dados" class="hist-tab-content">
      <div class="hist-field-group">
        <div class="hist-field-label">WhatsApp</div>
        <input class="hist-input" id="hf-tel" type="tel" placeholder="(38) 9 9999-9999" value="${userData.tel||''}">
        <div class="hist-field-label" style="margin-top:12px">Endereço principal</div>
        <div style="position:relative">
          <input class="hist-input" id="hf-end" type="text" placeholder="Rua, número, bairro, cidade" value="${userData.end||''}">
          <div class="autocomplete-list" id="hf-end-auto" style="display:none"></div>
        </div>
        <button class="hist-save-btn" onclick="saveHistDados()">Salvar dados</button>
      </div>
    </div>
    <div id="tab-pedidos" class="hist-tab-content" style="display:none">
      <div class="hist-loading"><div class="hist-spinner"></div>Carregando pedidos...</div>
    </div>`;
  loadHistPedidos();
  // Autocomplete endereço no perfil
  const hfEnd=document.getElementById('hf-end');
  if(hfEnd){
    let hfT=null;
    hfEnd.addEventListener('input',()=>{
      clearTimeout(hfT);
      const val=hfEnd.value.trim();
      const list=document.getElementById('hf-end-auto');
      if(val.length<4){if(list)list.style.display='none';return;}
      hfT=setTimeout(async()=>{
        try{
          const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=br&limit=5&addressdetails=1&accept-language=pt-BR`,{headers:{'User-Agent':'DluhFestas/1.0'}});
          const data=await res.json();
          if(!data.length){list.style.display='none';return;}
          list.style.display='block';
          list.innerHTML=data.map(p=>{
            const addr=p.address||{};
            const main=[addr.road,addr.house_number].filter(Boolean).join(', ')||p.display_name.split(',')[0];
            const sec=[addr.suburb||addr.neighbourhood,addr.city||addr.town,addr.state].filter(Boolean).join(', ');
            const full=[addr.road,addr.house_number,addr.suburb||addr.neighbourhood,addr.city||addr.town,addr.state].filter(Boolean).join(', ');
            return`<div class="autocomplete-item" onclick="selectHfEnd('${full.replace(/'/g,"\\'")}')">
              <div class="autocomplete-main">${main}</div>
              ${sec?`<div class="autocomplete-sub">${sec}</div>`:''}
            </div>`;
          }).join('');
        }catch(e){}
      },350);
    });
  }
}

function selectHfEnd(formatted){
  const inp=document.getElementById('hf-end');
  const list=document.getElementById('hf-end-auto');
  if(inp)inp.value=formatted;
  if(list)list.style.display='none';
}

function switchTab(btn,tabId){
  document.querySelectorAll('.hist-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.hist-tab-content').forEach(t=>t.style.display='none');
  btn.classList.add('active');
  document.getElementById(tabId).style.display='block';
}

async function loadHistPedidos(){
  const user=window._fbUser;if(!user)return;
  const container=document.getElementById('tab-pedidos');if(!container)return;
  try{
    const pedidos=await window._fbGetPedidos(user.uid);
    if(!pedidos.length){container.innerHTML='<div class="hist-empty">Você ainda não fez nenhum pedido. 🛍️</div>';return;}
    const lista=pedidos.map(p=>{
      const dt=p.criadoEm?.toDate?p.criadoEm.toDate().toLocaleDateString('pt-BR'):'—';
      return`<div class="hist-pedido">
        <div class="hist-pedido-header">
          <div><div class="hist-pedido-data">${dt}${p.hora?' às '+p.hora:''}</div>
          <div class="hist-pedido-total">${p.total?'R$ '+Number(p.total).toFixed(2).replace('.',','):''}</div></div>
          <span class="hist-pedido-status">${p.entrega||'Retirada'}</span>
        </div>
        <div class="hist-pedido-itens">${(p.itensTexto||'').replace(/\n/g,'<br>')}</div>
      </div>`;
    }).join('');
    container.innerHTML=`<div style="font-size:13px;color:var(--text3);margin-bottom:12px">${pedidos.length} pedido${pedidos.length>1?'s':''}</div>${lista}`;
  }catch(e){container.innerHTML='<div class="hist-empty">Erro ao carregar pedidos.</div>';}
}

function saveHistDados(){
  const tel=document.getElementById('hf-tel')?.value||'';
  const end=document.getElementById('hf-end')?.value||'';
  try{localStorage.setItem('dluh_userdata',JSON.stringify({tel,end}));}catch(e){}
  const fTel=document.getElementById('f-tel');const fEnd=document.getElementById('f-end');
  if(fTel&&tel)fTel.value=tel;
  if(fEnd&&end)fEnd.value=end;
  showToast('Dados salvos! ✓');
}


function doSignOut() {
  if (window._fbSignOut) window._fbSignOut().then(() => closeHistModal());
}

// ── SALVA PEDIDO NO FIREBASE ao finalizar ──
async function salvarPedidoFirebase(dados) {
  if (!window._fbUser || !window._fbAddDoc) return;
  try {
    await window._fbAddDoc('pedidos', {
      uid: window._fbUser.uid,
      nome: dados.nome,
      email: window._fbUser.email,
      tel: dados.tel,
      entrega: dados.entrega,
      endereco: dados.endereco,
      pagamento: dados.pagamento,
      data: dados.data,
      hora: dados.hora,
      obs: dados.obs,
      total: dados.total,
      itensTexto: dados.itensTexto,
      status: 'Aguardando confirmação',
      criadoEm: window._fbServerTimestamp()
    });
  } catch(e) {
    console.warn('Erro ao salvar no Firebase:', e);
  }
}

