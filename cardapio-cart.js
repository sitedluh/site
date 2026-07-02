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
  renderMaisVendidos();
  renderDrawer();
  _syncEditFooter();
}

function showSkeletons(n=4){
  const skEl=`<div class="skeleton-card"><div class="sk-img"></div><div class="sk-body"><div class="sk-line sk-line-title"></div><div class="sk-line sk-line-sub"></div><div class="sk-line sk-line-price"></div></div></div>`;
  const html=Array(n).fill(skEl).join('');
  const ml=document.getElementById('prod-list');
  if(ml)ml.innerHTML=html;
  const dg=document.getElementById('prod-grid');
  if(dg)dg.innerHTML=html;
  const cc=document.getElementById('catalog-content');
  if(cc)cc.style.display='';
  const ls=document.getElementById('loading-state');
  if(ls)ls.style.display='none';
}

async function loadProducts(){
  showSkeletons();
  document.getElementById('error-state').style.display='none';
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
        return{id:row.id,nome:row.nome||'',ingredientes:row.ingredientes||'',valorUnit,qtdMin,valor:valorUnit*qtdMin,tipo:row.tipo||'Outros',mostrar:true,imagem:row.imagem||null,popular:row.popular||false};
      }
      const valorUnit=parseBRL(row.values[CONFIG.COLS.valor]);
      const qtdMin=parseInt(row.values[CONFIG.COLS.qtdMin])||1;
      return{id:row.id,nome:row.values[CONFIG.COLS.nome]||'',ingredientes:row.values[CONFIG.COLS.ingredientes]||'',valorUnit,qtdMin,valor:valorUnit*qtdMin,tipo:row.values[CONFIG.COLS.tipo]||'Outros',mostrar:row.values['Mostrar'],popular:false};
    }).filter(p=>p.nome&&p.valorUnit>0);
    categories=['Todos',...new Set(allProducts.map(p=>p.tipo))];
    _aplicarRanking(); // se o ranking já chegou, ordena antes do primeiro render

    if(resRec.ok){
      const dataRec=await resRec.json();
      const recList=dataRec.recheios||dataRec.items||[];
      recheios=recList.map(r=>typeof r==='string'?r:(r.nome||r.values?.['Recheios']||r.name||'')).filter(Boolean);
    }

    renderFilters();
    renderMaisVendidos();
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

function renderFilters(){
  const bar=document.getElementById('cats-row');
  if(!bar)return;
  bar.innerHTML=categories.map(cat=>
    `<button class="cat-pill2${activeCategory===cat?' active':''}" onclick="selectCategory('${cat.replace(/'/g,"\\'")}')">` + cat + `</button>`
  ).join('');
  const active=bar.querySelector('.active');
  if(active)bar.scrollLeft=active.offsetLeft-bar.offsetWidth/2+active.offsetWidth/2;
}

function renderMaisVendidos(){
  const popular=allProducts.filter(p=>p.popular);
  const sec=document.getElementById('mv-section');
  if(!sec)return;
  if(!popular.length){sec.style.display='none';return;}
  sec.style.display='';
  const strip=document.getElementById('mv-strip');
  if(!strip)return;
  strip.innerHTML=popular.map(p=>{
    const qty=cart[p.id]?.qty||0;
    return`<div class="mv-card" data-id="${p.id}" onclick="scrollToProduct('${p.id}')">
      ${p.imagem?`<img class="mv-img" src="${CONFIG.WORKER_URL}/imagem-produto?url=${encodeURIComponent(p.imagem)}" alt="${p.nome}" loading="lazy">`:`<div class="mv-icon">${getIcon(p.tipo)}</div>`}
      ${qty>0?`<span class="mv-badge">${qty}</span>`:''}
      <div class="mv-name">${p.nome}</div>
      <div class="mv-price">${fmtBRL(p.valor)}</div>
    </div>`;
  }).join('');
}

function scrollToProduct(id){
  if(activeCategory!=='Todos')selectCategory('Todos');
  setTimeout(()=>{
    const el=document.getElementById(`add-${id}`)||document.getElementById(`dadd-${id}`);
    if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
  },80);
}

function refreshCardQty(id){
  const p=allProducts.find(x=>x.id===id);
  if(!p)return;
  const qty=cart[id]?.qty||0;
  const isEmpty=qty===0;
  // Mobile
  const mAdd=document.getElementById(`add-${id}`);
  if(mAdd){
    mAdd.classList.toggle('empty',isEmpty);
    const plus=mAdd.querySelector('.qty-plus');
    if(plus)plus.textContent=isEmpty?'+ Adicionar ao pedido':'+';
    const inp=mAdd.querySelector('.qty-input');
    if(inp)inp.value=qty;
    const item=mAdd.closest('.prod-item');
    if(item){
      let badge=item.querySelector('.prod-item-badge');
      if(qty>0){
        if(!badge){badge=document.createElement('span');badge.className='prod-item-badge';const wrap=item.querySelector('.produto-img-thumb')?.parentElement||item.querySelector('.prod-item-icon');if(wrap)wrap.appendChild(badge);}
        badge.textContent=qty;badge.style.display='flex';
      }else if(badge){badge.style.display='none';}
    }
  }
  // Desktop
  const dAdd=document.getElementById(`dadd-${id}`);
  if(dAdd){
    dAdd.classList.toggle('empty',isEmpty);
    const plus=dAdd.querySelector('.dc-plus');
    if(plus)plus.textContent=isEmpty?'+ Adicionar ao pedido':'+';
    const inp=dAdd.querySelector('.qty-input');
    if(inp)inp.value=qty;
    if(!p.imagem){
      const card=dAdd.closest('.prod-card');
      if(card){
        let badge=card.querySelector('.prod-card-badge');
        if(qty>0){
          if(!badge){badge=document.createElement('span');badge.className='prod-card-badge';const thumb=card.querySelector('.prod-card-thumb');if(thumb)thumb.appendChild(badge);}
          badge.textContent=qty+' no pedido';badge.style.background='#fff';badge.style.color='#0f0f0f';badge.style.display='';
        }else if(badge){
          if(p.qtdMin>1){badge.textContent=`Mín. ${p.qtdMin} un.`;badge.style.background='';badge.style.color='';}
          else badge.style.display='none';
        }
      }
    }
  }
  // Mais vendidos badge
  const mvCard=document.querySelector(`.mv-card[data-id="${id}"]`);
  if(mvCard){
    let mvBadge=mvCard.querySelector('.mv-badge');
    if(qty>0){if(!mvBadge){mvBadge=document.createElement('span');mvBadge.className='mv-badge';mvCard.insertBefore(mvBadge,mvCard.firstChild);}mvBadge.textContent=qty;}
    else if(mvBadge)mvBadge.remove();
  }
  renderDrawer();
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

// Builders de card (mobile e desktop) — reutilizados pela lista normal e pelo top 3 da semana
function _buildProdItem(p){
  const qty=cart[p.id]?.qty||0;const isEmpty=qty===0;
  const recheioInfo=isBolo(p.tipo)&&qty>0?`<div class="prod-item-sub" style="color:#888;margin-top:2px">🎂 ${qty} bolo${qty>1?'s':''} — recheios definidos</div>`:'';
  const precoTotal=p.valor;const precoUni=p.qtdMin>1?p.valorUnit:null;
  return`<div class="prod-item">
    <div class="prod-item-top">
      ${p.imagem?`<div style="position:relative;flex-shrink:0"><img class="produto-img-thumb" src="${CONFIG.WORKER_URL}/imagem-produto?url=${encodeURIComponent(p.imagem)}" alt="${p.nome}" loading="lazy">${qty>0?`<span class="prod-item-badge">${qty}</span>`:''}</div>`:`<div class="prod-item-icon">${getIcon(p.tipo)}${qty>0?`<span class="prod-item-badge">${qty}</span>`:''}</div>`}
      <div class="prod-item-body">
        ${p.popular?'<span class="badge-popular">⭐ Mais pedido</span>':''}
        <div class="prod-item-name">${p.nome}</div>
        <div class="prod-item-sub">Mín. ${p.qtdMin} unid. · ${p.tipo}</div>
        ${p.ingredientes?`<div class="prod-item-sub" style="margin-top:2px">${p.ingredientes}</div>`:''}
        <div class="prod-item-price">${fmtBRL(precoTotal)}${precoUni?`<span class="prod-item-unit">${fmtBRL(precoUni)}/un.</span>`:''}</div>
        ${p.qtdMin>1?`<div class="prod-item-pkg">pacote com ${p.qtdMin} unidades</div>`:''}
        ${recheioInfo}
      </div>
    </div>
    <div class="add-area ${isEmpty?'empty':''}" id="add-${p.id}">
      <button class="qty-minus" onclick="changeQty('${p.id}',-1)">−</button>
      <input class="qty-input" type="number" min="${p.qtdMin}" value="${qty}" onchange="setQtyInput('${p.id}',this.value,${p.qtdMin})" onblur="(function(el){if(!cart['${p.id}'])return;const n=parseInt(el.value,10);if(isNaN(n)||n<${p.qtdMin}){el.value=${p.qtdMin};setQtyInput('${p.id}',${p.qtdMin},${p.qtdMin})}})(this)">
      <button class="qty-plus" onclick="changeQty('${p.id}',1)">${isEmpty?'+ Adicionar ao pedido':'+'}</button>
    </div>
  </div>`;
}

function _buildProdCard(p){
  const qty=cart[p.id]?.qty||0;const isEmpty=qty===0;
  const precoTotal=p.valor;const precoUni=p.qtdMin>1?p.valorUnit:null;
  return`<div class="prod-card">
    ${p.imagem?`<img class="produto-img" src="${CONFIG.WORKER_URL}/imagem-produto?url=${encodeURIComponent(p.imagem)}" alt="${p.nome}" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px 8px 0 0;display:block;">`:''}
    ${!p.imagem?`<div class="prod-card-thumb">${getIcon(p.tipo)}${p.qtdMin>1&&qty===0?`<span class="prod-card-badge">Mín. ${p.qtdMin} un.</span>`:''}${qty>0?`<span class="prod-card-badge" style="background:#fff;color:#0f0f0f">${qty} no pedido</span>`:''}</div>`:''}
    <div class="prod-card-body">
      ${p.popular?'<span class="badge-popular">⭐ Mais pedido</span>':''}
      <div class="prod-card-type">${p.tipo}</div>
      <div class="prod-card-name">${p.nome}</div>
      ${p.ingredientes?`<div class="prod-card-ingr">${p.ingredientes}</div>`:''}
      <div class="prod-card-price">${fmtBRL(precoTotal)}${precoUni?`<span class="prod-card-unit">${fmtBRL(precoUni)}/un.</span>`:''}</div>
      ${p.qtdMin>1?`<div class="prod-card-pkg">pacote com ${p.qtdMin} unidades</div>`:''}
    </div>
    <div class="prod-card-add ${isEmpty?'empty':''}" id="dadd-${p.id}">
      <button class="dc-minus" onclick="changeQty('${p.id}',-1)">−</button>
      <input class="qty-input" type="number" min="${p.qtdMin}" value="${qty}" onchange="setQtyInput('${p.id}',this.value,${p.qtdMin})" onblur="(function(el){if(!cart['${p.id}'])return;const n=parseInt(el.value,10);if(isNaN(n)||n<${p.qtdMin}){el.value=${p.qtdMin};setQtyInput('${p.id}',${p.qtdMin},${p.qtdMin})}})(this)">
      <button class="dc-plus" onclick="changeQty('${p.id}',1)">${isEmpty?'+ Adicionar ao pedido':'+'}</button>
    </div>
  </div>`;
}

function renderProducts(){
  let filtered=allProducts;
  if(activeCategory!=='Todos')filtered=filtered.filter(p=>p.tipo===activeCategory);
  if(searchQuery){const q=searchQuery.toLowerCase();filtered=filtered.filter(p=>p.nome.toLowerCase().includes(q)||p.ingredientes.toLowerCase().includes(q)||p.tipo.toLowerCase().includes(q));}
  document.getElementById('results-sub').textContent=`${filtered.length} produto${filtered.length!==1?'s':''}`;
  document.getElementById('cat-title').textContent=searchQuery?`Resultados para "${searchQuery}"`:activeCategory==='Todos'?'Todos os produtos':activeCategory;
  // Top 3 da semana só aparece na visão padrão ("Todos", sem busca)
  const mostrarTop=activeCategory==='Todos'&&!searchQuery;
  renderTopSemana(mostrarTop);
  const noRes=document.getElementById('no-results');
  if(!filtered.length){document.getElementById('prod-list').innerHTML='';document.getElementById('prod-grid').innerHTML='';noRes.style.display='block';return;}
  noRes.style.display='none';
  // Quando o destaque está visível, os 3 produtos saem da lista normal (evita IDs duplicados)
  let lista=filtered;
  if(mostrarTop&&_top3Semana.length){
    const topIds=new Set(_top3Semana.map(r=>r.prod.id));
    lista=filtered.filter(p=>!topIds.has(p.id));
  }
  // MOBILE LIST
  document.getElementById('prod-list').innerHTML=lista.map(_buildProdItem).join('');
  // DESKTOP GRID
  document.getElementById('prod-grid').innerHTML=lista.map(_buildProdCard).join('');
}

// ── RANKING DE MAIS VENDIDOS (GET /ranking-produtos) ──
// Busca em paralelo com loadProducts(); se falhar/vier vazio, o catálogo fica como antes.
let _rankingMes=null;      // Map nome normalizado → quantidade vendida no mês
let _rankingSemana=null;   // lista crua da semana [{produto,quantidade,compradores}]
let _top3Semana=[];        // até 3 itens {prod,quantidade,compradores} presentes no catálogo
let _tswTimer=null,_tswModo=0;

function _rankNorm(s){return String(s||'').trim().toLowerCase();}

async function loadRanking(){
  try{
    const ctrl=new AbortController();
    const to=setTimeout(()=>ctrl.abort(),8000);
    const res=await fetch(`${CONFIG.WORKER_URL}/ranking-produtos`,{signal:ctrl.signal});
    clearTimeout(to);
    if(!res.ok)return;
    const data=await res.json();
    const mes=Array.isArray(data.mes)?data.mes:[];
    const semana=Array.isArray(data.semana)?data.semana:[];
    if(!mes.length&&!semana.length)return;
    _rankingMes=new Map();
    mes.forEach(r=>{const k=_rankNorm(r.produto);if(k&&!_rankingMes.has(k))_rankingMes.set(k,Number(r.quantidade)||0);});
    _rankingSemana=semana;
    _aplicarRanking();
    // Se os produtos já renderizaram, reordena/insere o destaque agora
    if(allProducts.length)renderProducts();
  }catch(e){/* silencioso: sem ranking, catálogo renderiza como sempre */}
}

function _aplicarRanking(){
  if(!allProducts.length)return;
  // Ordenação estável: quem vendeu no mês vem primeiro (desc); sem venda mantém a ordem original
  if(_rankingMes&&_rankingMes.size){
    allProducts=allProducts.map((p,i)=>({p,i})).sort((a,b)=>{
      const qa=_rankingMes.get(_rankNorm(a.p.nome)),qb=_rankingMes.get(_rankNorm(b.p.nome));
      if(qa!==undefined&&qb!==undefined)return(qb-qa)||(a.i-b.i);
      if(qa!==undefined)return -1;
      if(qb!==undefined)return 1;
      return a.i-b.i;
    }).map(x=>x.p);
  }
  // Top 3 da semana que existem no catálogo visível
  _top3Semana=[];
  if(Array.isArray(_rankingSemana)){
    for(const r of _rankingSemana){
      const prod=allProducts.find(p=>_rankNorm(p.nome)===_rankNorm(r.produto));
      if(prod){
        _top3Semana.push({prod,quantidade:Number(r.quantidade)||0,compradores:Number(r.compradores)||0});
        if(_top3Semana.length===3)break;
      }
    }
  }
}

function _tswTexto(comp,qtd,modo){
  if(modo===0&&comp>0)return comp===1?'👥 1 pessoa comprou essa semana':`👥 ${comp} pessoas compraram essa semana`;
  return qtd===1?'🧁 1 unidade vendida na semana':`🧁 ${qtd} unidades vendidas na semana`;
}

function _tswWrap(r,i,inner){
  const pos=i+1;
  return`<div class="tsw-card tsw-rank-${pos}">
    ${pos===1?'<span class="tsw-crown">👑</span>':''}
    <span class="tsw-pos">${pos}º</span>
    ${inner}
    <div class="tsw-counter" data-compradores="${r.compradores}" data-quantidade="${r.quantidade}"><span class="tsw-counter-text">${_tswTexto(r.compradores,r.quantidade,_tswModo)}</span></div>
  </div>`;
}

function renderTopSemana(mostrar){
  const sec=document.getElementById('top-semana-section');
  if(!sec)return;
  const ok=mostrar&&_top3Semana.length>0;
  if(!ok){
    sec.style.display='none';
    if(_tswTimer){clearInterval(_tswTimer);_tswTimer=null;}
    return;
  }
  sec.style.display='';
  document.getElementById('top-semana-list').innerHTML=_top3Semana.map((r,i)=>_tswWrap(r,i,_buildProdItem(r.prod))).join('');
  document.getElementById('top-semana-grid').innerHTML=_top3Semana.map((r,i)=>_tswWrap(r,i,_buildProdCard(r.prod))).join('');
  _tswIniciarContador();
}

function _tswIniciarContador(){
  if(_tswTimer)clearInterval(_tswTimer);
  _tswTimer=setInterval(()=>{
    _tswModo=1-_tswModo;
    document.querySelectorAll('.tsw-counter').forEach(el=>{
      const span=el.querySelector('.tsw-counter-text');
      if(!span)return;
      span.classList.add('tsw-fade-out');
      setTimeout(()=>{
        span.textContent=_tswTexto(Number(el.dataset.compradores)||0,Number(el.dataset.quantidade)||0,_tswModo);
        span.classList.remove('tsw-fade-out');
      },300);
    });
  },4000);
}

function cancelarEdicao(){
  try{localStorage.removeItem('dluh_edit_pedido');}catch(e){}
  renderDrawer();
  _syncEditFooter();
}

function renderDrawer(){
  const items=Object.values(cart).filter(i=>i.qty>0);
  const total=items.reduce((s,i)=>s+i.valorUnit*i.qty,0);
  const totalQty=items.reduce((s,i)=>s+i.qty,0);
  document.getElementById('cart-badge').textContent=totalQty;
  const floatBtn=document.getElementById('cart-float');
  const floatBadge=document.getElementById('cart-float-badge');
  if(floatBadge)floatBadge.textContent=totalQty;
  if(floatBtn){if(totalQty>0){floatBtn.classList.remove('cart-float-zero');}else{floatBtn.classList.add('cart-float-zero');}}
  document.getElementById('drawer-total').textContent=fmtBRL(total);
  const footer=document.getElementById('drawer-footer');
  // Banner de modo edição
  let bannerHtml='';
  try{
    const _editRaw=localStorage.getItem('dluh_edit_pedido');
    if(_editRaw){
      const _ed=JSON.parse(_editRaw);
      bannerHtml=`<div class="edit-mode-banner"><div class="edit-mode-banner-top"><span class="edit-mode-icon">✏️</span><span class="edit-mode-title">Editando pedido ${_ed.pedidoNum||''}</span></div><div class="edit-mode-pago">Valor já pago: <strong>${fmtBRL(_ed.valorPago||0)}</strong></div><button class="edit-mode-cancel" onclick="cancelarEdicao()">Cancelar edição</button></div>`;
    }
  }catch(e){}
  if(!items.length){document.getElementById('drawer-body').innerHTML=bannerHtml+`<div class="empty-cart-msg"><div class="empty-icon">🛍️</div><p>Seu carrinho está vazio.</p></div>`;footer.style.display='none';return;}
  footer.style.display='block';
  document.getElementById('drawer-body').innerHTML=bannerHtml+items.map(i=>{
    const recheioLines=isBolo(i.tipo)&&i.recheios?i.recheios.map((r,idx)=>`<div style="font-size:11px;color:#666;margin-top:1px">Bolo ${idx+1}: ${r.join(' + ')||'sem recheio'}</div>`).join(''):'';
    return`<div class="cart-item">
      <div class="cart-item-icon">${getIcon(i.tipo)}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${i.nome}</div>
        <div class="cart-item-price">${fmtBRL(i.valorUnit)}/un. · ${i.qty} unid.</div>
        ${recheioLines}
        <div class="cart-qty-ctrl">
          <button class="cart-qty-btn" onclick="changeQty('${i.id}',-1)">−</button>
          <span class="cart-qty-num">${i.qty}</span>
          <button class="cart-qty-btn" onclick="changeQty('${i.id}',1)">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <div class="cart-subtotal">${fmtBRL(i.valorUnit*i.qty)}</div>
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
  const qtdMin=p.qtdMin||1;
  const current=cart[id]?.qty||0;

  if(delta>0){
    const newQty=current===0?qtdMin:current+1;
    if(!cart[id])cart[id]={...p,qty:0,recheios:[]};
    const oldQty=cart[id].qty;
    cart[id].qty=newQty;

    if(isBolo(p.tipo)&&recheios.length>0){
      const novasUnidades=[];
      for(let i=oldQty;i<newQty;i++)novasUnidades.push(i);
      saveCart();refreshCardQty(id);
      abrirModalRecheios(id,novasUnidades);
      return;
    }

    saveCart();refreshCardQty(id);
    if(navigator.vibrate)navigator.vibrate(50);
    const btn=document.querySelector(`#add-${id} .qty-plus`)||document.querySelector(`#dadd-${id} .qty-plus`);
    if(btn){btn.classList.add('adding');setTimeout(()=>btn.classList.remove('adding'),350);}
    if(current===0)showToast(`${p.nome} adicionado!`);
  }else{
    if(current<=qtdMin){
      delete cart[id];
    }else{
      cart[id].qty=current-1;
      if(isBolo(p.tipo)&&cart[id].recheios)cart[id].recheios.splice(cart[id].qty);
    }
    saveCart();refreshCardQty(id);
  }
}

function setQtyInput(id,value,qtdMin){
  const p=allProducts.find(x=>x.id===id);if(!p)return;
  const n=parseInt(value,10);
  if(isNaN(n)||n<=0){
    delete cart[id];
  }else if(n<qtdMin){
    showToast('Você digitou um valor menor que o mínimo');
    const curQty=cart[id]?.qty||0;
    const inp=document.querySelector(`#add-${id} .qty-input`)||document.querySelector(`#dadd-${id} .qty-input`);
    if(inp)inp.value=curQty>0?curQty:qtdMin;
    return;
  }else{
    if(!cart[id])cart[id]={...p,qty:n,recheios:[]};
    else cart[id].qty=n;
  }
  saveCart();refreshCardQty(id);
}

function removeItem(id){delete cart[id];refreshCardQty(id);saveCart();}
function selectCategory(cat){
  activeCategory=cat;searchQuery='';
  const si=document.getElementById('search-input');if(si)si.value='';
  const clr=document.getElementById('search-clear');if(clr)clr.style.display='none';
  renderFilters();renderProducts();
}
function handleSearch(){
  searchQuery=document.getElementById('search-input').value.trim();
  if(searchQuery)activeCategory='Todos';
  const clr=document.getElementById('search-clear');
  if(clr)clr.style.display=searchQuery?'block':'none';
  renderFilters();renderProducts();
}
function clearSearch(){
  document.getElementById('search-input').value='';
  searchQuery='';
  const clr=document.getElementById('search-clear');
  if(clr)clr.style.display='none';
  renderFilters();renderProducts();
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
  },{passive:false});

  wrap.addEventListener('touchend',e=>{
    if(isDesktop()||!isSwiping)return;
    const dx=touchStartX-e.changedTouches[0].clientX;
    const dt=Date.now()-touchStartTime;
    const velocity=Math.abs(dx)/dt;
    const t=document.getElementById('prod-list-track');

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
      nextCat=null;
    }
    isSwiping=false;
  });
}

// chama após carregar produtos
const _origRenderProducts=renderProducts;
renderProducts=function(){_origRenderProducts.apply(this,arguments);initSwipe();};

// ── MODO EDIÇÃO: footer fixo e preenchimento do carrinho ──
function _syncEditFooter(){
  let el=document.getElementById('edit-concluir-footer');
  const hasEdit=!!localStorage.getItem('dluh_edit_pedido');
  if(hasEdit){
    if(!el){
      el=document.createElement('div');
      el.id='edit-concluir-footer';
      el.innerHTML='<span class="ecf-label">✏️ Editando pedido</span><button class="ecf-btn" onclick="goCheckout()">✓ Concluir edição</button>';
      document.body.appendChild(el);
    }
    el.style.display='flex';
  }else{
    if(el)el.style.display='none';
  }
}

window.editarCarrinhoComItens=function(itens){
  clearCart();
  if(!Array.isArray(itens))itens=[];
  itens.forEach(function(item){
    const nomeLower=(item.nome||'').trim().toLowerCase();
    const prod=allProducts.find(function(p){return p.nome.trim().toLowerCase()===nomeLower;});
    if(prod){
      cart[prod.id]={...prod,qty:item.qtd,recheios:[]};
      if(item.recheio&&isBolo(prod.tipo)){
        const recheioArr=Array.isArray(item.recheio)?item.recheio:[item.recheio];
        cart[prod.id].recheios=Array.from({length:item.qtd},function(){return recheioArr.slice(0,2);});
      }
    }else{
      const fakeId='_edit_'+item.nome;
      const valorUnit=Number(item.valor)||0;
      cart[fakeId]={id:fakeId,nome:item.nome,ingredientes:'',valorUnit:valorUnit,qtdMin:1,valor:valorUnit,tipo:'Outros',qty:item.qtd,recheios:[]};
    }
  });
  saveCart();renderProducts();renderMaisVendidos();renderDrawer();
  _syncEditFooter();
};

document.addEventListener('DOMContentLoaded',_syncEditFooter);

loadProducts();
loadRanking();

