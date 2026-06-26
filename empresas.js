
const CONFIG = {
  WORKER_URL: 'https://coda-proxy.sitedluh.workers.dev',
  WHATSAPP: '5538992229178',
  COLS: { nome:'Produto', ingredientes:'Ingredientes', valor:'Valor', tipo:'Tipo', qtdMin:'Quantidade mínima' }
};

const TIPO_ICONS = {'Salgado':'🥐','Frito':'🥐','Assado':'🥖','Doce':'🍬','Gourmet':'✨','Bolo':'🎂','Torta':'🥧','Lanche':'🥪','default':'🍽️'};
function getIcon(t){if(!t)return TIPO_ICONS.default;const k=Object.keys(TIPO_ICONS).find(k=>t.toLowerCase().includes(k.toLowerCase()));return k?TIPO_ICONS[k]:TIPO_ICONS.default;}
function parseBRL(v){return parseFloat((String(v||'0')).replace('R$','').replace(/\./g,'').replace(',','.'))||0;}
function fmtBRL(v){return'R$ '+v.toFixed(2).replace('.',',');}
function isBolo(tipo){return tipo&&tipo.toLowerCase().includes('bolo');}

let allProducts=[],categories=[],cart={},activeCategory='Todos',searchQuery='';
let recheios=[];
// recheiosPendentes: fila de {prodId, unidadeIdx} esperando escolha
let recheiosPendentes=[],recheioAtual=0,recheiosSelecionados=[];
// topper: mapa prodId → {quero, tema, detalhes, refFile, refUrl}
let topperPorProduto={},_topperProdIdAtual=null;


// ── PERSISTÊNCIA DO CARRINHO ──
function saveCart(){
  try{
    // Salva apenas os dados essenciais (sem funções)
    const cartData={};
    Object.entries(cart).forEach(([id,item])=>{
      cartData[id]={
        id:item.id,nome:item.nome,ingredientes:item.ingredientes,
        valorUnit:item.valorUnit,qtdMin:item.qtdMin,valor:item.valor,
        tipo:item.tipo,qty:item.qty,
        recheios:item.recheios||[]
      };
    });
    localStorage.setItem('dluh_cart',JSON.stringify(cartData));
  }catch(e){console.warn('Erro ao salvar carrinho:',e);}
}

function loadCart(){
  try{
    const saved=localStorage.getItem('dluh_cart');
    if(!saved)return;
    const cartData=JSON.parse(saved);
    // Só restaura se os produtos já foram carregados
    Object.entries(cartData).forEach(([id,item])=>{
      const prod=allProducts.find(p=>p.id===id);
      if(prod){cart[id]={...prod,qty:item.qty,recheios:item.recheios||[]};}
    });
  }catch(e){console.warn('Erro ao carregar carrinho:',e);}
}

function clearCart(){
  cart={};
  try{localStorage.removeItem('dluh_cart');}catch(e){}
  renderProducts();
  renderDrawer();
}

async function loadProducts(){
  document.getElementById('loading-state').style.display='flex';
  document.getElementById('error-state').style.display='none';
  document.getElementById('catalog-content').style.display='none';
  try{
    const [resProd,resRec]=await Promise.all([
      fetch(`${CONFIG.WORKER_URL}/produtos`),
      fetch(`${CONFIG.WORKER_URL}/recheios`)
    ]);
    if(!resProd.ok)throw new Error(resProd.status);
    const dataProd=await resProd.json();
    allProducts=(dataProd.produtos||dataProd.items||[]).map(row=>{
      // Suporte ao novo formato ({nome,valor,tipo,...}) e ao legado ({values:{...}})
      if(row.nome!==undefined){
        const valorUnit=Number(row.valorEmpresa!==undefined?row.valorEmpresa:row.valor)||0;
        const qtdMin=Number(row.qtdMinEmpresa!==undefined?row.qtdMinEmpresa:row.qtdMin)||1;
        const mostrarEmpresa=row.mostrarEmpresa!==undefined?row.mostrarEmpresa:true;
        return{id:row.id,nome:row.nome||'',ingredientes:row.ingredientes||'',valorUnit,qtdMin,valor:valorUnit*qtdMin,tipo:row.tipo||'Outros',mostrar:true,mostrarEmpresa};
      }
      const valorUnit=parseBRL(row.values[CONFIG.COLS.valor]);
      const qtdMin=parseInt(row.values[CONFIG.COLS.qtdMin])||1;
      return{id:row.id,nome:row.values[CONFIG.COLS.nome]||'',ingredientes:row.values[CONFIG.COLS.ingredientes]||'',valorUnit,qtdMin,valor:valorUnit*qtdMin,tipo:row.values[CONFIG.COLS.tipo]||'Outros',mostrar:row.values['Mostrar'],mostrarEmpresa:row.values['Mostrar Empresa']};
    }).filter(p=>p.nome&&p.valorUnit>0&&p.mostrarEmpresa!==false);
    categories=['Todos',...new Set(allProducts.map(p=>p.tipo))];

    if(resRec.ok){
      const dataRec=await resRec.json();
      const recList=dataRec.recheios||dataRec.items||[];
      recheios=recList.map(r=>typeof r==='string'?r:(r.nome||r.values?.['Recheios']||r.name||'')).filter(Boolean);
    }

    renderCats();
    loadCart();
    renderProducts();
    renderDrawer();
    document.getElementById('loading-state').style.display='none';
    document.getElementById('catalog-content').style.display='block';
  }catch(e){
    document.getElementById('loading-state').style.display='none';
    document.getElementById('error-state').style.display='block';
    console.error('Erro ao carregar produtos:', e);
  }
}

function renderCats(){
  // Mobile pills
  const bar=document.getElementById('cat-bar');
  let indicator=document.getElementById('cat-indicator');
  bar.innerHTML=categories.map(cat=>`<button class="cat-pill ${cat===activeCategory?'active':''}" onclick="selectCategory('${cat.replace(/'/g,"\\'")}')">${cat==='Todos'?'Todos':cat}</button>`).join('');
  if(!indicator){indicator=document.createElement('div');indicator.id='cat-indicator';indicator.className='cat-indicator';}
  bar.appendChild(indicator);
  const active=bar.querySelector('.active');
  if(active)active.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  setTimeout(()=>positionIndicator(activeCategory),50);
  // Desktop icon cats
  const desk=document.getElementById('cat-desktop');
  if(desk){
    let inner=desk.querySelector('.cat-desktop-inner');
    if(!inner){inner=document.createElement('div');inner.className='cat-desktop-inner';desk.appendChild(inner);}
    inner.innerHTML=categories.map(cat=>{
      const count=cat==='Todos'?allProducts.length:allProducts.filter(p=>p.tipo===cat).length;
      const icon=cat==='Todos'?'🛍️':getIcon(cat);
      return`<button class="cat-icon-btn ${cat===activeCategory?'active':''}" onclick="selectCategory('${cat.replace(/'/g,"\\'")}')">
        <span class="cat-icon-emoji">${icon}</span>
        <span class="cat-icon-name">${cat==='Todos'?'Todos':cat}</span>
        <span class="cat-icon-count">${count} item${count!==1?'s':''}</span>
      </button>`;
    }).join('');
  }
}

function positionIndicator(cat,progress,nextCat){
  const bar=document.getElementById('cat-bar');
  const indicator=document.getElementById('cat-indicator');
  if(!bar||!indicator)return;
  const pills=bar.querySelectorAll('.cat-pill');
  const curIdx=categories.indexOf(cat);
  const curPill=pills[curIdx];
  if(!curPill)return;
  // Usa padding interno do pill para alinhar com o texto
  const style=window.getComputedStyle(curPill);
  const padL=parseFloat(style.paddingLeft);
  const padR=parseFloat(style.paddingRight);
  let left=curPill.offsetLeft+padL;
  let width=curPill.offsetWidth-padL-padR;
  if(nextCat&&progress!=null&&progress<1){
    const nextIdx=categories.indexOf(nextCat);
    const nextPill=pills[nextIdx];
    if(nextPill){
      const nStyle=window.getComputedStyle(nextPill);
      const nPadL=parseFloat(nStyle.paddingLeft);
      const nPadR=parseFloat(nStyle.paddingRight);
      const nextLeft=nextPill.offsetLeft+nPadL;
      const nextWidth=nextPill.offsetWidth-nPadL-nPadR;
      left=left+(nextLeft-left)*progress;
      width=width+(nextWidth-width)*progress;
    }
  }
  indicator.style.transform=`translateX(${left}px)`;
  indicator.style.width=width+'px';
}

function renderProducts(){
  let filtered=allProducts;
  if(activeCategory!=='Todos')filtered=filtered.filter(p=>p.tipo===activeCategory);
  if(searchQuery){const q=searchQuery.toLowerCase();filtered=filtered.filter(p=>p.nome.toLowerCase().includes(q)||p.ingredientes.toLowerCase().includes(q)||p.tipo.toLowerCase().includes(q));}
  document.getElementById('results-sub').textContent=`${filtered.length} produto${filtered.length!==1?'s':''}`;
  document.getElementById('cat-title').textContent=searchQuery?`Resultados para "${searchQuery}"`:activeCategory==='Todos'?'Todos os produtos':activeCategory;
  const noRes=document.getElementById('no-results');
  if(!filtered.length){document.getElementById('prod-list').innerHTML='';document.getElementById('prod-grid').innerHTML='';noRes.style.display='block';return;}
  noRes.style.display='none';
  // MOBILE LIST
  document.getElementById('prod-list').innerHTML=filtered.map(p=>{
    const qty=cart[p.id]?.qty||0;const isEmpty=qty===0;
    const recheioInfo=isBolo(p.tipo)&&qty>0?`<div class="prod-item-sub" style="color:#888;margin-top:2px">🎂 ${qty} bolo${qty>1?'s':''} — recheios definidos</div>`:'';
    return`<div class="prod-item">
      <div class="prod-item-top">
        <div class="prod-item-icon">${getIcon(p.tipo)}${qty>0?`<span class="prod-item-badge">${qty}</span>`:''}</div>
        <div class="prod-item-body">
          <div class="prod-item-name">${p.nome}</div>
          <div class="prod-item-sub">Mín. ${p.qtdMin} unid. · ${p.tipo}</div>
          ${p.ingredientes?`<div class="prod-item-sub" style="margin-top:2px">${p.ingredientes}</div>`:''}
          <div class="prod-item-price">${fmtBRL(p.valor)}${p.qtdMin>1?`<span class="prod-item-unit">${fmtBRL(p.valorUnit)}/un.</span>`:''}</div>
          ${p.qtdMin>1?`<div class="prod-item-pkg">pacote com ${p.qtdMin} unidades</div>`:''}
          ${recheioInfo}
        </div>
      </div>
      <div class="add-area ${isEmpty?'empty':''}" id="add-${p.id}">
        <button class="qty-minus" onclick="changeQty('${p.id}',-1)">−</button>
        <div class="qty-val">${qty>0?qty*p.qtdMin:0}</div>
        <button class="qty-plus" onclick="changeQty('${p.id}',1)">${isEmpty?'+ Adicionar ao pedido':'+'}</button>
      </div>
    </div>`;
  }).join('');
  // DESKTOP GRID
  document.getElementById('prod-grid').innerHTML=filtered.map(p=>{
    const qty=cart[p.id]?.qty||0;const isEmpty=qty===0;
    return`<div class="prod-card">
      <div class="prod-card-thumb">${getIcon(p.tipo)}${p.qtdMin>1&&qty===0?`<span class="prod-card-badge">Mín. ${p.qtdMin} un.</span>`:''}${qty>0?`<span class="prod-card-badge" style="background:#fff;color:#0f0f0f">${qty} no pedido</span>`:''}</div>
      <div class="prod-card-body">
        <div class="prod-card-type">${p.tipo}</div>
        <div class="prod-card-name">${p.nome}</div>
        ${p.ingredientes?`<div class="prod-card-ingr">${p.ingredientes}</div>`:''}
        <div class="prod-card-price">${fmtBRL(p.valor)}${p.qtdMin>1?`<span class="prod-card-unit">${fmtBRL(p.valorUnit)}/un.</span>`:''}</div>
        ${p.qtdMin>1?`<div class="prod-card-pkg">pacote com ${p.qtdMin} unidades</div>`:''}
      </div>
      <div class="prod-card-add ${isEmpty?'empty':''}" id="dadd-${p.id}">
        <button class="dc-minus" onclick="changeQty('${p.id}',-1)">−</button>
        <div class="dc-val">${qty>0?qty*p.qtdMin:0}</div>
        <button class="dc-plus" onclick="changeQty('${p.id}',1)">${isEmpty?'+ Adicionar ao pedido':'+'}</button>
      </div>
    </div>`;
  }).join('');
}

function renderDrawer(){
  const items=Object.values(cart).filter(i=>i.qty>0);
  const total=items.reduce((s,i)=>s+i.valor*i.qty,0);
  const totalQty=items.reduce((s,i)=>s+i.qty,0);
  document.getElementById('cart-badge').textContent=totalQty;
  const floatBtn=document.getElementById('cart-float');
  const floatBadge=document.getElementById('cart-float-badge');
  if(floatBadge)floatBadge.textContent=totalQty;
  if(floatBtn){if(totalQty>0){floatBtn.classList.remove('cart-float-zero');}else{floatBtn.classList.add('cart-float-zero');}}
  document.getElementById('drawer-total').textContent=fmtBRL(total);
  const footer=document.getElementById('drawer-footer');
  if(!items.length){document.getElementById('drawer-body').innerHTML=`<div class="empty-cart-msg"><div class="empty-icon">🛍️</div><p>Seu carrinho está vazio.</p></div>`;footer.style.display='none';return;}
  footer.style.display='block';
  document.getElementById('drawer-body').innerHTML=items.map(i=>{
    const recheioLines=isBolo(i.tipo)&&i.recheios?i.recheios.map((r,idx)=>`<div style="font-size:11px;color:#666;margin-top:1px">Bolo ${idx+1}: ${r.join(' + ')||'sem recheio'}</div>`).join(''):'';
    return`<div class="cart-item">
      <div class="cart-item-icon">${getIcon(i.tipo)}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${i.nome}</div>
        <div class="cart-item-price">${fmtBRL(i.valorUnit)}/un. · ${i.qty*i.qtdMin} unid.</div>
        ${recheioLines}
        <div class="cart-qty-ctrl">
          <button class="cart-qty-btn" onclick="changeQty('${i.id}',-1)">−</button>
          <span class="cart-qty-num">${i.qty*i.qtdMin}</span>
          <button class="cart-qty-btn" onclick="changeQty('${i.id}',1)">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="cart-subtotal">${fmtBRL(i.valor*i.qty)}</div>
        <button class="remove-btn" onclick="removeItem('${i.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ── RECHEIOS MODAL ──
function abrirModalRecheios(prodId, novasUnidades){
  // novasUnidades: array de índices das unidades novas que precisam de recheio
  recheiosPendentes=novasUnidades.map(idx=>({prodId,unidadeIdx:idx}));
  recheioAtual=0;
  recheiosSelecionados=[];
  renderModalStep();
  document.getElementById('modal-recheios').classList.add('open');
}

function renderModalStep(){
  const total=recheiosPendentes.length;
  const atual=recheioAtual;
  const pend=recheiosPendentes[atual];
  const p=allProducts.find(x=>x.id===pend.prodId);

  document.getElementById('modal-title').textContent=`Recheios — ${p.nome}`;
  document.getElementById('modal-subtitle').textContent=`Bolo ${pend.unidadeIdx+1} de ${total} — escolha até 2 recheios`;
  document.getElementById('modal-bolo-label').textContent=`🎂 Bolo ${pend.unidadeIdx+1}`;

  // progress dots
  document.getElementById('modal-progress').innerHTML=recheiosPendentes.map((_,i)=>
    `<div class="modal-step ${i<atual?'done':i===atual?'active':''}"></div>`
  ).join('');

  recheiosSelecionados[atual]=recheiosSelecionados[atual]||[];
  const sel=recheiosSelecionados[atual];

  document.getElementById('recheio-grid').innerHTML=recheios.map(r=>{
    const isSel=sel.includes(r);
    const isDisabled=!isSel&&sel.length>=2;
    return`<button class="recheio-btn ${isSel?'selected':''} ${isDisabled?'disabled':''}"
      onclick="toggleRecheio('${r.replace(/'/g,"\\'")}')">
      ${isSel?'✓ ':''} ${r}
    </button>`;
  }).join('');

  document.getElementById('modal-btn-next').disabled=sel.length===0;
  document.getElementById('modal-btn-next').textContent=atual<total-1?'Próximo →':'Confirmar ✓';
}

function toggleRecheio(nome){
  const sel=recheiosSelecionados[recheioAtual]||[];
  const idx=sel.indexOf(nome);
  if(idx>=0){sel.splice(idx,1);}
  else if(sel.length<2){sel.push(nome);}
  recheiosSelecionados[recheioAtual]=sel;
  renderModalStep();
}

function nextRecheio(){
  if(recheioAtual<recheiosPendentes.length-1){
    recheioAtual++;
    renderModalStep();
  }else{
    // salva recheios no cart
    const prodId=recheiosPendentes[0].prodId;
    if(!cart[prodId].recheios)cart[prodId].recheios=[];
    recheiosPendentes.forEach((pend,i)=>{
      cart[prodId].recheios[pend.unidadeIdx]=recheiosSelecionados[i]||[];
    });
    document.getElementById('modal-recheios').classList.remove('open');
    renderProducts();renderDrawer();saveCart();
    const _pIdR=recheiosPendentes[0].prodId;
    if(isBolo(cart[_pIdR]?.tipo)&&!topperPorProduto[_pIdR])openTopperModal(_pIdR);
    else showToast('Recheios salvos!');
  }
}

function skipRecheio(){
  recheiosSelecionados[recheioAtual]=[];
  if(recheioAtual<recheiosPendentes.length-1){
    recheioAtual++;
    renderModalStep();
  }else{
    const prodId=recheiosPendentes[0].prodId;
    if(!cart[prodId].recheios)cart[prodId].recheios=[];
    recheiosPendentes.forEach((pend,i)=>{
      cart[prodId].recheios[pend.unidadeIdx]=recheiosSelecionados[i]||[];
    });
    document.getElementById('modal-recheios').classList.remove('open');
    renderProducts();renderDrawer();saveCart();
    const _pIdS=recheiosPendentes[0].prodId;
    if(isBolo(cart[_pIdS]?.tipo)&&!topperPorProduto[_pIdS])openTopperModal(_pIdS);
  }
}

function openTopperModal(prodId){
  _topperProdIdAtual=prodId;
  document.getElementById('topper-step1').style.display='';
  document.getElementById('topper-step2').style.display='none';
  document.getElementById('topper-footer').style.display='none';
  document.getElementById('modal-topper').classList.add('open');
}
function topperEscolha(quero){
  if(!quero){
    topperPorProduto[_topperProdIdAtual]={quero:false};
    document.getElementById('modal-topper').classList.remove('open');
    showToast('Recheios salvos!');
    return;
  }
  document.getElementById('topper-step1').style.display='none';
  document.getElementById('topper-step2').style.display='';
  document.getElementById('topper-footer').style.display='';
  document.getElementById('topper-tema').value='';
  document.getElementById('topper-detalhes').value='';
  document.getElementById('topper-ref').value='';
  document.getElementById('topper-preview').innerHTML='';
  document.getElementById('topper-ref-label').textContent='Escolher imagem';
}
function fecharTopperModal(){
  topperPorProduto[_topperProdIdAtual]={quero:false};
  document.getElementById('modal-topper').classList.remove('open');
  showToast('Recheios salvos!');
}
function confirmarTopper(){
  const tema=document.getElementById('topper-tema').value.trim();
  if(!tema){showToast('Informe o tema do topper');return;}
  const detalhes=document.getElementById('topper-detalhes').value.trim();
  const refFile=document.getElementById('topper-ref').files[0]||null;
  topperPorProduto[_topperProdIdAtual]={quero:true,tema,detalhes,refFile,refUrl:''};
  document.getElementById('modal-topper').classList.remove('open');
  showToast('Topper adicionado! 🎂');
}
function handleTopperPreview(input){
  const file=input.files[0];if(!file)return;
  document.getElementById('topper-ref-label').textContent=file.name;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=document.createElement('img');img.src=e.target.result;img.className='topper-preview-img';
    const prev=document.getElementById('topper-preview');prev.innerHTML='';prev.appendChild(img);
  };
  reader.readAsDataURL(file);
}

function changeQty(id,delta){
  const p=allProducts.find(x=>x.id===id);if(!p)return;
  if(!cart[id])cart[id]={...p,qty:0,recheios:[]};
  const oldQty=cart[id].qty;
  cart[id].qty=Math.max(0,cart[id].qty+delta);
  if(cart[id].qty===0){delete cart[id];renderProducts();renderDrawer();return;}

  if(delta>0&&isBolo(p.tipo)&&recheios.length>0){
    // abre modal para cada unidade nova adicionada
    const novasUnidades=[];
    for(let i=oldQty;i<cart[id].qty;i++)novasUnidades.push(i);
    renderProducts();renderDrawer();
    abrirModalRecheios(id,novasUnidades);
    return;
  }

  if(delta<0&&isBolo(p.tipo)){
    // remove o último recheio
    if(cart[id].recheios)cart[id].recheios.splice(cart[id].qty);
  }

  renderProducts();renderDrawer();saveCart();
  if(delta>0&&oldQty===0)showToast(`${p.nome} adicionado!`);
}

function removeItem(id){delete cart[id];renderProducts();renderDrawer();saveCart();}
function selectCategory(cat){activeCategory=cat;searchQuery='';document.getElementById('search-input').value='';renderCats();renderProducts();}
function handleSearch(){
  searchQuery=document.getElementById('search-input').value.trim();
  if(searchQuery)activeCategory='Todos';
  const clr=document.getElementById('search-clear');
  if(clr)clr.style.display=searchQuery?'block':'none';
  renderCats();renderProducts();
}
function clearSearch(){
  document.getElementById('search-input').value='';
  searchQuery='';
  const clr=document.getElementById('search-clear');
  if(clr)clr.style.display='none';
  renderCats();renderProducts();
}
function openDrawer(){document.getElementById('drawer').classList.add('open');document.getElementById('overlay').classList.add('open');}
function closeDrawer(){document.getElementById('drawer').classList.remove('open');document.getElementById('overlay').classList.remove('open');}

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
  const total=items.reduce((s,i)=>s+i.valor*i.qty,0)+topperExtra+taxaEntrega;
  document.getElementById('order-review').innerHTML=`<div class="order-review">
    ${items.map(i=>{
      let linhas=`<div class="order-review-item"><span>${i.nome} · ${i.qty*i.qtdMin} unid.</span><span>${fmtBRL(i.valor*i.qty)}</span></div>`;
      if(isBolo(i.tipo)&&i.recheios){
        i.recheios.forEach((r,idx)=>{
          linhas+=`<div style="font-size:12px;color:#666;padding:2px 0 2px 12px">Bolo ${idx+1}: ${r.length?r.join(' + '):'sem recheio'}</div>`;
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
  document.body.classList.add('checkout-active');
  window.scrollTo(0,0);
  // Reseta slider de entrada para 50% e recalcula
  const sliderEl=document.getElementById('f-entrada-pct');
  if(sliderEl)sliderEl.value=50;
  atualizarEntrada();
  loadUserData();
  goCheckoutPushState();
  // Pré-preenche nome se logado
  const fNome=document.getElementById('f-nome');
  if(fNome&&!fNome.value&&window._fbUser)fNome.value=window._fbUser.displayName||'';
}

function showCatalog(){
  document.getElementById('checkout-page').classList.remove('active');
  document.getElementById('catalog-page').classList.remove('hidden');
  document.body.classList.remove('checkout-active');
  window.scrollTo(0,0);
  const profile=document.querySelector('.profile');
  if(profile)profile.style.display='';
  renderDrawer();
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

function atualizarEntrada(){
  const items=Object.values(cart).filter(i=>i.qty>0);
  const topperBonus=items.filter(i=>topperPorProduto[i.id]?.quero).length*20;
  const taxaFrete=getRadio('rg-entrega')==='Entrega em endereço'?(_taxaEntregaAtual||0):0;
  const total=items.reduce((s,i)=>s+i.valor*i.qty,0)+topperBonus+taxaFrete;
  const slider=document.getElementById('f-entrada-pct');
  const pct=parseInt(slider?.value||50)/100;
  const entrada=Math.round(total*pct*100)/100;
  const resto=Math.round((total-entrada)*100)/100;
  // Atualiza gradiente do slider
  if(slider){const p=(pct-0.5)/0.5*100;slider.style.background=`linear-gradient(to right,var(--accent) 0%,var(--accent) ${p}%,var(--border) ${p}%,var(--border) 100%)`;}
  if(document.getElementById('entrada-pct-label'))document.getElementById('entrada-pct-label').textContent=Math.round(pct*100)+'%';
  if(document.getElementById('entrada-val'))document.getElementById('entrada-val').textContent=fmtBRL(entrada);
  if(document.getElementById('entrada-resto'))document.getElementById('entrada-resto').textContent=fmtBRL(Math.max(0,resto));
}
function getRadio(groupId){const a=document.querySelector('#'+groupId+' .radio-opt.active');return a?a.dataset.val:'';}
// Carrega os horários disponíveis (slots fixos de 15 em 15 min, 08:00–19:00) para a data
// escolhida, consultando o Worker, que verifica a capacidade já comprometida em "Calendário Base"
// contra o limite cadastrado em "Limites". Slots cheios ficam desabilitados com aviso "Horário cheio".
let _horariosIndisponiveis=new Set();
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
async function carregarHorarios(dataStr){
  const horaEl=document.getElementById('f-hora');
  const statusEl=document.getElementById('f-hora-status');
  if(!horaEl)return;
  _horariosIndisponiveis=new Set();
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
  const slots=gerarSlotsHorario();
  const cheios={};
  try{
    const res=await fetch(`${CONFIG.WORKER_URL}/horarios-disponiveis?data=${encodeURIComponent(dataStr)}`);
    if(res.ok){
      const json=await res.json();
      (json.slots||[]).forEach(s=>{ if(s.cheio) cheios[s.hora]=true; });
    }
  }catch(e){
    console.warn('Não foi possível verificar disponibilidade de horários:',e);
  }
  horaEl.innerHTML='<option value="">Selecione um horário</option>'+slots.map(h=>{
    const cheio=!!cheios[h];
    if(cheio)_horariosIndisponiveis.add(h);
    return `<option value="${h}"${cheio?' disabled':''}>${h}${cheio?' — Horário cheio':''}</option>`;
  }).join('');
  horaEl.disabled=false;
  if(statusEl)statusEl.textContent=Object.keys(cheios).length?'Alguns horários estão cheios e não podem ser selecionados — escolha outro horário disponível.':'';
}
function validate(){
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
  let horaInvalida=false,horaMsg='';
  if(ehDomingo){
    horaInvalida=true;
    horaMsg='Não atendemos aos domingos — escolha outro dia';
  }else if(!horaVal){
    horaInvalida=true;
    horaMsg='Selecione um horário desejado entre 08:00 e 19:00';
  }else if(_horariosIndisponiveis.has(horaVal)){
    horaInvalida=true;
    horaMsg='Esse horário ficou cheio — selecione outro horário disponível';
  }
  if(horaMsgEl)horaMsgEl.textContent=horaMsg;
  markError(horaRow,horaInvalida);
  if(horaInvalida)ok=false;

  if(firstErrorEl){
    firstErrorEl.scrollIntoView({behavior:'smooth',block:'center'});
    const campo=firstErrorEl.querySelector('input,select,textarea');
    if(campo)campo.focus({preventScroll:true});
  }
  return ok;
}
let _enviandoPedido=false;

// ── Phone mask & validation ──
function maskPhone(input){
  let v=input.value.replace(/\D/g,'');
  if(v.length>11)v=v.slice(0,11);
  if(v.length<=10){
    v=v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3');
  } else {
    v=v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');
  }
  input.value=v.replace(/-$/,'');
}
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
  showConfirmPhone();
  return;
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
    const total=items.reduce((s,i)=>s+i.valor*i.qty,0)+topperBonus+taxaFrete;
    const entradaPct=parseInt(document.getElementById('f-entrada-pct')?.value||50)/100;
    const entradaVal=Math.round(total*entradaPct*100)/100;
    const restoVal=Math.round((total-entradaVal)*100)/100;
    const horaVal=document.getElementById('f-hora')?.value||'';

    // Monta mensagem WhatsApp
    let msg=`🛍️ *NOVO PEDIDO — D'Luh Festas*\n\n👤 *Cliente:* ${nome}\n📱 *WhatsApp:* ${tel}\n📦 *Entrega:* ${entrega==='Entrega em endereço'?`Entrega — ${endereco}`:'Retirada no local'}\n💳 *Pagamento:* ${pagamento}\n`;
    if(data)msg+=`📅 *Data:* ${data.split('-').reverse().join('/')}${horaVal?' às '+horaVal:''}\n`;
    msg+=`\n📋 *Itens:*\n`;
    items.forEach(i=>{
      msg+=`  • ${i.nome} — ${i.qty*i.qtdMin} unid. = ${fmtBRL(i.valor*i.qty)}\n`;
      if(isBolo(i.tipo)&&i.recheios)i.recheios.forEach((r,idx)=>{msg+=`    Bolo ${idx+1}: ${r.length?r.join(' + '):'sem recheio'}\n`;});
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
      {column:'Tipo Cliente',value:'Empresa'},
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
      const recheiosTxt=(isBolo(i.tipo)&&i.recheios)?i.recheios.map((r,idx)=>`Bolo ${idx+1}: ${Array.isArray(r)?r.join(' + '):r||'sem recheio'}`).join(' | '):'';
      return [
        {column:'Produto',value:i.nome},
        {column:'Row ID Produto',value:i.id},
        {column:'Quantidade',value:i.qty*i.qtdMin},
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
      let txt=`${i.nome} · ${i.qty*i.qtdMin} unid. = R$ ${(i.valor*i.qty).toFixed(2)}`;
      if(isBolo(i.tipo)&&i.recheios)i.recheios.forEach((r,idx)=>{txt+=`\n  Bolo ${idx+1}: ${r.length?r.join(' + '):'sem recheio'}`;});
      return txt;
    }).join('\n');

    // Guarda os dados montados — usados pela confirmação (e por retry/skip se algo falhar)
    // 'msg' (resumo formatado p/ WhatsApp) é reaproveitado pelo bot pra postar o mesmo
    // resumo dentro do próprio chat, ver abrirStatusBotPosPedido() (seção 2.5).
    _pedidoPendente={paiCells,subrowInputs,taxaFrete,waUrl,msg,nome,tel,entrega,endereco,pagamento,data,horaVal,obs,total,entradaVal,restoVal,itensTexto,items};

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

// Envia o pedido para o Coda (worker /novo-pedido) e só então segue para o WhatsApp.
// Pode ser chamada de novo pelo botão "Tentar novamente" no overlay de erro.
async function _confirmarESeguirWhats(){
  const p=_pedidoPendente;
  if(!p||_confirmandoPedido)return;
  _confirmandoPedido=true;
  setPedidoLoadingState('loading');
  try{
    const ctrl=new AbortController();
    const timeoutId=setTimeout(()=>ctrl.abort(),15000);
    let res,d;
    try{
      res=await fetch(`${CONFIG.WORKER_URL}/novo-pedido`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pai:p.paiCells,subrows:p.subrowInputs,taxaFrete:p.taxaFrete}),
        signal:ctrl.signal
      });
    }finally{ clearTimeout(timeoutId); }
    d=await res.json().catch(()=>({}));
    if(!res.ok||!d||d.ok===false) throw new Error((d&&d.error)?d.error:'Falha ao registrar pedido no Coda');
    p.paiId=d.paiId||null; // ID (Coda) do pedido recém-criado — usado pra rastrear ESSE pedido no acompanhamento pós-pedido

    try{document.getElementById('coda-note').textContent='✅ Pedido registrado!';}catch(_){}

    // Extras não-críticos: não atrasam a abertura do chat, só disparam depois que o essencial confirmou
    salvarPedidoFirebase({nome:p.nome,tel:p.tel,entrega:p.entrega,endereco:p.endereco,pagamento:p.pagamento,data:p.data,hora:p.horaVal,obs:p.obs,total:p.total,entradaVal:p.entradaVal,restoVal:p.restoVal,itensTexto:p.itensTexto});
    // (a foto de referência do topper, se houver, já foi enviada ao Drive antes
    // de montar as subrows — o link está em topperPorProduto[id].refUrl / na subrow)

    setPedidoLoadingState('success');
    clearCart();topperPorProduto={};
    _pedidoPendente=null;
    // Em vez de ir direto pro WhatsApp, abre o bot de status (chat próprio) —
    // ele já mostra a situação atual e pode ser consultado de novo a qualquer momento.
    setTimeout(()=>abrirStatusBotPosPedido(p),700);
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
  return `<div class="mp-card" data-idpedido="${esc(p.idPedido)}" onclick="mpMarcarVisto('${esc(p.idPedido)}')">
    <div class="mp-card-top">
      <span class="mp-badge ${cls}">${esc(p.status)}</span>
      ${mudou?'<span class="mp-novo">🔔 Atualizado</span>':''}
    </div>
    <div class="mp-card-data">${esc(p.data||'')}</div>
    <div class="mp-card-itens">${esc(itensResumo)}</div>
    <div class="mp-card-valores">${p.total?`Total: ${fmtBRL(p.total)}`:''}${p.valorPago?` · Pago: ${fmtBRL(p.valorPago)}`:''}${p.restante>0?` · Falta: ${fmtBRL(p.restante)}`:''}</div>
    <div class="mp-card-actions">
      ${podePagar?`<button class="mp-btn-pagar" onclick="event.stopPropagation();window.open('${esc(p.linkPagamento)}','_blank')">💳 Pagar ${fmtBRL(valorPagar)}</button>`:''}
      ${podeCancelar?`<button class="mp-btn-cancelar" onclick="event.stopPropagation();mpIniciarCancelamento('${esc(p.idPedido)}')">❌ Cancelar</button>`:''}
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
    mpFecharModalCancelar();
    mpCarregar();
  }catch(e){
    showToast('Erro ao cancelar. Tente novamente.');
    btn.disabled=false;
    btn.textContent='Confirmar cancelamento';
  }
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
  sbBotoes([{label:'💬 Falar com atendente',onClick:()=>sbAtendente()}]);
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
  }else{
    sbFimOpcoes();
  }
  // Retoma o polling em segundo plano, sem abrir o painel sozinho.
  _sbPollTel=sessao.tel;
  _sbPollPaiId=sessao.paiId||null;
  _sbPollWaUrl=sessao.waUrl||null;
  _sbPollUltimoStatus=sessao.status||'Aguardando confirmação';
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
    if(!res.ok||!pedidos.length){
      sbAddMsg('bot','Hmm, não achei nenhum pedido com esse telefone. 🤔 Quer:');
      sbBotoes([
        {label:'📱 Tentar outro número',onClick:()=>sbStatusPedirTelefoneInput()},
        {label:'🛒 Fazer um pedido',onClick:()=>sbNovoPedido()},
        {label:'💬 Falar com atendente',onClick:()=>sbAtendente()},
      ]);
      return;
    }
    pedidos.forEach(p=>{
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
    sbFimOpcoes();
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

function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000);}

// ── Notificações de atualização de pedido (toast sempre + Notification do navegador) ──
// Unifica os dois pontos que avisam o cliente sobre mudança de status (bot de
// acompanhamento e painel "Meus Pedidos") — toast sempre aparece; a notificação do
// navegador só dispara se a aba estiver em segundo plano/sem foco e a permissão já
// tiver sido concedida (pedida uma única vez, em sbPedirPermissaoNotificacao()).
function dluhNotificar(texto){
  showToast(texto);
  try{
    if((document.hidden||!document.hasFocus())&&window.Notification&&Notification.permission==='granted'){
      new Notification("D'Luh Festas",{body:texto});
    }
  }catch(_){}
}
function sbPedirPermissaoNotificacao(){
  try{
    if(window.Notification&&Notification.permission==='default')Notification.requestPermission();
  }catch(_){}
}

// SWIPE — desliza lista atual para o lado, nova aparece
let touchStartX=0,touchStartY=0,touchStartTime=0,isSwiping=false,swipeBlocked=false,nextCat=null;

function isDesktop(){return window.innerWidth>=768;}

function initSwipe(){
  const wrap=document.getElementById('prod-list-wrap');
  if(!wrap||wrap._swipeInit)return;
  wrap._swipeInit=true;

  wrap.addEventListener('touchstart',e=>{
    if(isDesktop()||e.touches.length>1)return;
    touchStartX=e.touches[0].clientX;
    touchStartY=e.touches[0].clientY;
    touchStartTime=Date.now();
    isSwiping=false;swipeBlocked=false;nextCat=null;
    const t=document.getElementById('prod-list-track');
    if(t){t.style.transition='none';}
  },{passive:true});

  wrap.addEventListener('touchmove',e=>{
    if(isDesktop()||swipeBlocked||e.touches.length>1)return;
    const dx=e.touches[0].clientX-touchStartX;
    const dy=e.touches[0].clientY-touchStartY;
    if(!isSwiping){
      if(Math.abs(dy)>Math.abs(dx)+5){swipeBlocked=true;return;}
      if(Math.abs(dx)>10){
        isSwiping=true;
        const idx=categories.indexOf(activeCategory);
        nextCat=dx<0&&idx<categories.length-1?categories[idx+1]:dx>0&&idx>0?categories[idx-1]:null;
      }
    }
    if(!isSwiping)return;
    e.preventDefault();
    const t=document.getElementById('prod-list-track');
    if(t)t.style.transform=`translateX(${dx}px)`;
    // Move indicador e bar
    if(nextCat){
      const ratio=Math.min(Math.abs(dx)/wrap.offsetWidth,1);
      positionIndicator(activeCategory,ratio,nextCat);
      const bar=document.getElementById('cat-bar');
      if(bar){
        const pills=bar.querySelectorAll('.cat-pill');
        const curIdx=categories.indexOf(activeCategory);
        const nextIdx=categories.indexOf(nextCat);
        pills.forEach((p,i)=>{
          if(i===curIdx)p.style.color=`rgba(31,20,16,${1-ratio*0.6})`;
          else if(i===nextIdx)p.style.color=`rgba(31,20,16,${0.4+ratio*0.6})`;
          else p.style.color='';
        });
      }
    }
  },{passive:false});

  wrap.addEventListener('touchend',e=>{
    if(isDesktop()||!isSwiping)return;
    const dx=touchStartX-e.changedTouches[0].clientX;
    const dt=Date.now()-touchStartTime;
    const velocity=Math.abs(dx)/dt;
    const t=document.getElementById('prod-list-track');
    const bar=document.getElementById('cat-bar');
    if(bar)bar.querySelectorAll('.cat-pill').forEach(p=>p.style.color='');

    if(nextCat&&(Math.abs(dx)>60||velocity>0.4)){
      // Anima saída
      if(t){
        t.style.transition='transform .22s cubic-bezier(.4,0,.2,1)';
        t.style.transform=`translateX(${dx>0?-wrap.offsetWidth:wrap.offsetWidth}px)`;
      }
      setTimeout(()=>{
        selectCategory(nextCat);
        if(t){t.style.transition='none';t.style.transform='translateX(0)';}
        nextCat=null;
      },230);
    } else {
      if(t){
        t.style.transition='transform .2s cubic-bezier(.4,0,.2,1)';
        t.style.transform='translateX(0)';
      }
      positionIndicator(activeCategory);
      nextCat=null;
    }
    isSwiping=false;
  });
}

// chama após carregar produtos
const _origRenderProducts=renderProducts;
renderProducts=function(){_origRenderProducts.apply(this,arguments);initSwipe();};


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

// ── CEP ──
function formatCep(v){return v.replace(/\D/g,'').replace(/^(\d{5})(\d)/,'$1-$2').slice(0,9);}


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
}
function liberarEntrega() {
  document.querySelectorAll('#rg-entrega .radio-opt').forEach(o => {
    o.style.opacity = '';
    o.style.pointerEvents = '';
    o.title = '';
  });
  const note = document.getElementById('dinheiro-note');
  if (note) note.style.display = 'none';
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
  dataEl.addEventListener('change',()=>carregarHorarios(dataEl.value));
  carregarHorarios(dataEl.value);
})();

loadProducts();

// ── LANDING PAGE ──
function verCardapio() {
  document.getElementById('ticker-section').style.display = 'none';
  // Esconde botão do hero (hero-content)
  const heroBtn = document.querySelector('.hero-btn');
  if (heroBtn) heroBtn.style.display = 'none';
  // Mostra elementos do catálogo
  ['search-section','cat-desktop','cat-mobile','page-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('landing-hidden');
  });
  // Rola suavemente para o catálogo
  setTimeout(() => {
    const cat = document.getElementById('cat-desktop') || document.getElementById('cat-bar');
    if (cat) cat.scrollIntoView({behavior:'smooth'});
  }, 100);
}

async function loadTicker() {
  try {
    const res = await fetch(CONFIG.WORKER_URL + '/produtos');
    const data = await res.json();
    const items = (data.items || []);
    if (!items.length) return;
    const track = document.getElementById('ticker-track');
    if (!track) return;
    const formatPrice = v => v ? ' — R$ ' + Number(v).toFixed(2).replace('.',',') : '';
    const makeItem = p => {
      const vals = p.values || {};
      const nome  = vals['Produto'] || vals['Nome'] || '';
      const preco = vals['Preço'] || vals['Valor'] || vals['Preco'] || '';
      const emoji = vals['Emoji'] || '🎂';
      const div = document.createElement('div');
      div.className = 'ticker-item';
      div.onclick = verCardapio;
      div.innerHTML = '<span class="ticker-item-emoji">' + emoji + '</span>' +
        '<span class="ticker-item-name">' + nome + '</span>' +
        '<span class="ticker-item-price">' + formatPrice(preco) + '</span>';
      return div;
    };
    // Duplica para loop contínuo
    const all = [...items, ...items];
    track.innerHTML = '';
    all.forEach(p => track.appendChild(makeItem(p)));
    const dur = Math.max(20, items.length * 3);
    track.style.animationDuration = dur + 's';
  } catch(e) {}
}

document.addEventListener('DOMContentLoaded', () => { loadTicker(); mpInit(); sbRestaurarSessao(); });

