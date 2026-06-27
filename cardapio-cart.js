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
        const valorUnit=Number(row.valor)||0;
        const qtdMin=Number(row.qtdMin)||1;
        return{id:row.id,nome:row.nome||'',ingredientes:row.ingredientes||'',valorUnit,qtdMin,valor:valorUnit*qtdMin,tipo:row.tipo||'Outros',mostrar:true,imagem:row.imagem||null};
      }
      const valorUnit=parseBRL(row.values[CONFIG.COLS.valor]);
      const qtdMin=parseInt(row.values[CONFIG.COLS.qtdMin])||1;
      return{id:row.id,nome:row.values[CONFIG.COLS.nome]||'',ingredientes:row.values[CONFIG.COLS.ingredientes]||'',valorUnit,qtdMin,valor:valorUnit*qtdMin,tipo:row.values[CONFIG.COLS.tipo]||'Outros',mostrar:row.values['Mostrar']};
    }).filter(p=>p.nome&&p.valorUnit>0);
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
      ${p.imagem?`<img class="produto-img" src="${CONFIG.WORKER_URL}/imagem-produto?url=${encodeURIComponent(p.imagem)}" alt="${p.nome}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px 8px 0 0;display:block;">`:''}
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
      ${p.imagem?`<img class="produto-img" src="${CONFIG.WORKER_URL}/imagem-produto?url=${encodeURIComponent(p.imagem)}" alt="${p.nome}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px 8px 0 0;display:block;">`:''}
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


loadProducts();

