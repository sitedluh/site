
const WORKER = 'https://coda-proxy.sitedluh.workers.dev';

// Deep-link: o link "Ver Admin" do Telegram chega como admin.html?rowId=XXX — depois que
// os pedidos carregarem, localizamos o card com esse rowId, trocamos pra aba certa e damos
// um destaque visual nele. Tentamos de novo a cada carregamento até achar (e então paramos).
let _deepLinkRowId = new URLSearchParams(location.search).get('rowId') || null;
function tentarDeepLink(){
  if(!_deepLinkRowId)return;
  const el=[...document.querySelectorAll('[data-rowid]')].find(c=>c.dataset.rowid===_deepLinkRowId);
  if(!el)return;
  const pane=el.closest('.tab-pane');
  if(pane)switchTab(pane.id.replace(/^tab-/,''));
  _deepLinkRowId=null; // achou — não tenta de novo
  setTimeout(()=>{
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.classList.add('highlight-pedido');
    setTimeout(()=>el.classList.remove('highlight-pedido'),2900);
  },150);
}

function fmtBRL(v){return'R$ '+Number(v||0).toFixed(2).replace('.',',');}
function fmtData(d){if(!d)return'—';const p=d.split('-');return p.length===3?p.reverse().join('/'):d;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function enc(s){return encodeURIComponent(s||'');}

function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}

// ── ESTOQUE ─────────────────────────────────────────────────────────────────

// Catálogo completo de produtos
let _produtosList = [];
let _produtosMap  = {};

// Carrega produtos + pedidos em paralelo; renderiza só depois que ambos chegarem
async function carregarPedidos(){
  const btn=document.getElementById('btn-refresh');
  btn.classList.add('loading');btn.disabled=true;
  try{
    const [prodData,pedData]=await Promise.all([
      fetch(`${WORKER}/produtos`).then(r=>r.json()).catch(()=>({produtos:[]})),
      fetch(`${WORKER}/pedidos-pendentes`).then(r=>r.json()).catch(()=>({pedidos:[]}))
    ]);
    const lista=prodData.produtos||[];
    _produtosList=lista.map(p=>p.nome);
    _produtosMap=Object.fromEntries(lista.map(p=>[p.nome,p.valorUnit]));
    const dl=document.getElementById('produtos-datalist');
    if(dl)dl.innerHTML=_produtosList.map(n=>`<option value="${esc(n)}">`).join('');
    renderPedidos(pedData.pedidos||[]);
  }catch(e){
    document.getElementById('main').innerHTML=`<div class="empty"><div class="empty-icon">⚠️</div>Erro ao carregar pedidos.<br><small>${e.message}</small></div>`;
  }finally{
    btn.classList.remove('loading');btn.disabled=false;
  }
}

function renderPedidos(pedidos){
  const main=document.getElementById('main');
  if(!pedidos.length){
    main.innerHTML='<div class="empty"><div class="empty-icon">✅</div>Nenhum pedido aguardando confirmação.</div>';
    return;
  }
  main.innerHTML=pedidos.map(p=>cardPedido(p)).join('');
  pedidos.forEach(p=>recalcCard(p.idPedido));
  tentarDeepLink();
}

// Monta <select> de produto com todos os itens do catálogo
function buildProdutoSelect(id,selectedNome){
  const inList=_produtosList.includes(selectedNome);
  const extraOpt=selectedNome&&!inList?`<option value="${esc(selectedNome)}" selected>${esc(selectedNome)}</option>`:'';
  const opts=_produtosList.map(n=>`<option value="${esc(n)}"${n===selectedNome?' selected':''}>${esc(n)}</option>`).join('');
  return `<select class="inp-nome" onchange="trocaProduto(this,'${id}')" style="${IS}width:100%">
    <option value="">— escolha o produto —</option>
    ${extraOpt}${opts}
    <option value="__outro__">✏️ Outro produto...</option>
  </select>`;
}

function trocaProduto(sel,id){
  const val=sel.value;
  if(!val)return;
  if(val==='__outro__'){
    // Troca select por campo de texto livre
    const td=sel.closest('td');
    td.innerHTML=`<input class="inp-nome" value="" placeholder="Nome do produto" list="produtos-datalist" style="${IS}width:100%">`;
    td.querySelector('.inp-nome').focus();
    return;
  }
  // Preenche preço unitário do produto selecionado
  const preco=(_produtosMap[val]||0).toFixed(2);
  console.log('[trocaProduto]',val,'→',preco,'| map keys:',Object.keys(_produtosMap).slice(0,3));
  const row=sel.closest('tr');
  const unitInput=row.querySelector('.inp-unit');
  console.log('[trocaProduto] unitInput encontrado:',!!unitInput);
  if(unitInput)unitInput.value=preco;
  recalcCard(id);
}

const IS='border:1px solid #e8e0d8;border-radius:6px;padding:4px 6px;font-size:13px;font-family:inherit;background:#fff;';

function cardPedido(p){
  const id=p.idPedido;
  const total=p.total||p.itens.reduce((s,i)=>s+(Number(i.valorItem)||0),0);

  // Taxa de entrega sempre por último
  const sortedItens=[...(p.itens||[])].sort((a,b)=>
    (a.produto.startsWith('🛵')?1:0)-(b.produto.startsWith('🛵')?1:0));

  const rows=sortedItens.map((i,idx)=>`
    <tr data-idx="${idx}" style="border-top:1px solid var(--border)">
      <td style="padding:7px 0">
        ${buildProdutoSelect(id,i.produto)}
        ${i.recheios?`<div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(i.recheios)}</div>`:''}
        ${i.topoInfo?`<div style="font-size:11px;color:var(--text3);margin-top:2px">🎨 ${esc(i.topoInfo.replace(/\n/g,' · '))}</div>`:''}
      </td>
      <td style="padding:7px 4px;text-align:center">
        <input class="inp-qty" type="number" value="${i.quantidade||1}" min="0.1" step="0.1" oninput="recalcCard('${id}')" style="${IS}width:52px;text-align:center">
      </td>
      <td style="padding:7px 4px;text-align:center">
        <input class="inp-unit" type="number" value="${Number(i.valorUnit||0).toFixed(2)}" min="0" step="0.01" oninput="recalcCard('${id}')" style="${IS}width:72px;text-align:center">
      </td>
      <td class="td-sub" style="padding:7px 0 7px 4px;text-align:right;font-size:13px;font-weight:600;white-space:nowrap">${fmtBRL(i.valorItem)}</td>
      <td style="padding:7px 0 7px 8px">
        <button onclick="this.closest('tr').remove();recalcCard('${id}')" style="background:none;border:none;cursor:pointer;color:#c0725a;font-size:18px;line-height:1;padding:0" title="Remover">×</button>
      </td>
    </tr>`).join('');

  return`<div class="card" id="card-${esc(id)}" data-id="${esc(id)}" data-rowid="${esc(p.rowId||'')}" data-cliente="${esc(p.cliente)}" data-telefone="${esc(p.telefone)}">
    <div class="card-header">
      <div>
        <div class="card-nome">${esc(p.cliente)}${p.tipoCliente==='Empresa'?' <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px;background:#dbeafe;color:#1e40af;vertical-align:middle">🏢 Empresa</span>':''}</div>
        <div class="card-meta">📱 ${esc(p.telefone)} · <b>${esc(p.entrega||'—')}</b> · <b>${fmtData(p.data)}${p.hora?' às '+esc(p.hora):''}</b></div>
        ${p.pagamento?`<div class="card-meta" style="margin-top:2px">💳 ${esc(p.pagamento)}</div>`:''}
        ${p.obs?`<div class="card-meta" style="margin-top:2px;color:var(--accent)">📝 ${esc(p.obs)}</div>`:''}
      </div>
      <span class="badge">Verificar estoque</span>
    </div>
    <div class="card-body">
      <div class="itens-titulo" style="margin-bottom:6px">Itens &mdash; <span style="font-weight:400;font-size:11px;color:var(--text3)">edite se precisar trocar produto</span></div>
      <div class="itens-table-wrap">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px">
            <th style="text-align:left;padding-bottom:4px;font-weight:600">Produto</th>
            <th style="text-align:center;padding-bottom:4px;font-weight:600;width:60px">Qtd</th>
            <th style="text-align:center;padding-bottom:4px;font-weight:600;width:80px">Unit</th>
            <th style="text-align:right;padding-bottom:4px;font-weight:600;width:90px">Subtotal</th>
            <th style="width:30px"></th>
          </tr>
        </thead>
        <tbody id="itens-body-${esc(id)}">${rows}</tbody>
      </table>
      </div>
      <button onclick="addItem('${esc(id)}')" style="background:none;border:1px dashed var(--border);border-radius:6px;padding:5px 12px;font-size:12px;color:var(--text3);cursor:pointer;width:100%;margin-top:8px;font-family:inherit">+ Adicionar item</button>

      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--surface2);border-radius:8px;padding:10px 12px;margin-top:12px">
        <div style="display:flex;align-items:center;gap:5px">
          <label style="font-size:12px;color:var(--text3);font-weight:600">Entrada</label>
          <input id="pct-${esc(id)}" type="number" value="50" min="1" max="100" step="1" oninput="recalcCard('${esc(id)}')" style="width:50px;border:1.5px solid var(--accent);border-radius:6px;padding:4px 5px;font-size:13px;font-weight:600;color:var(--accent);text-align:center;font-family:inherit">
          <span style="font-size:12px;color:var(--text3)">%</span>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--text2)">
          <span>Total: <b id="total-${esc(id)}">${fmtBRL(total)}</b></span>
          <span>Entrada: <b id="entrada-${esc(id)}">${fmtBRL(Math.round(total*.5*100)/100)}</b></span>
          <span>Restante: <b id="restante-${esc(id)}">${fmtBRL(Math.round(total*.5*100)/100)}</b></span>
        </div>
      </div>
    </div>
    <div class="card-footer">
      <button class="btn-apagar" onclick="abrirConfirmApagar('${esc(p.rowId||'')}','${esc(p.cliente)}',this)">
        🗑️ Apagar
      </button>
      <button onclick="notificarCliente('${esc(id)}')" style="background:none;border:1.5px solid #25d366;border-radius:var(--radius-sm);padding:10px 14px;font-size:13px;font-weight:600;color:#128c7e;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;white-space:nowrap">
        📱 Avisar cliente
      </button>
      <button class="btn-confirmar" onclick="confirmarEstoque('${esc(id)}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Confirmar e cobrar
      </button>
    </div>
  </div>`;
}

function recalcCard(id){
  const tbody=document.getElementById(`itens-body-${id}`);
  if(!tbody)return;
  let total=0;
  tbody.querySelectorAll('tr[data-idx]').forEach(row=>{
    const qty=parseFloat(row.querySelector('.inp-qty')?.value)||0;
    const unit=parseFloat(row.querySelector('.inp-unit')?.value)||0;
    const sub=Math.round(qty*unit*100)/100;
    total+=sub;
    const td=row.querySelector('.td-sub');
    if(td)td.textContent=fmtBRL(sub);
  });
  const pct=parseInt(document.getElementById(`pct-${id}`)?.value)||50;
  const entrada=Math.round(total*pct/100*100)/100;
  const restante=Math.round((total-entrada)*100)/100;
  const elT=document.getElementById(`total-${id}`);
  const elE=document.getElementById(`entrada-${id}`);
  const elR=document.getElementById(`restante-${id}`);
  if(elT)elT.textContent=fmtBRL(total);
  if(elE)elE.textContent=fmtBRL(entrada);
  if(elR)elR.textContent=fmtBRL(restante);
}

function addItem(id){
  const tbody=document.getElementById(`itens-body-${id}`);
  if(!tbody)return;
  const idx=tbody.querySelectorAll('tr').length;
  const tr=document.createElement('tr');
  tr.setAttribute('data-idx',idx);
  tr.style.borderTop='1px solid var(--border)';
  tr.innerHTML=`
    <td style="padding:7px 0">${buildProdutoSelect(id,'')}</td>
    <td style="padding:7px 4px;text-align:center"><input class="inp-qty" type="number" value="1" min="0.1" step="0.1" oninput="recalcCard('${id}')" style="${IS}width:52px;text-align:center"></td>
    <td style="padding:7px 4px;text-align:center"><input class="inp-unit" type="number" value="0.00" min="0" step="0.01" oninput="recalcCard('${id}')" style="${IS}width:72px;text-align:center"></td>
    <td class="td-sub" style="padding:7px 0 7px 4px;text-align:right;font-size:13px;font-weight:600">R$ 0,00</td>
    <td style="padding:7px 0 7px 8px"><button onclick="this.closest('tr').remove();recalcCard('${id}')" style="background:none;border:none;cursor:pointer;color:#c0725a;font-size:18px;line-height:1;padding:0">×</button></td>`;
  tbody.appendChild(tr);
}

// datalist para autocomplete nos inputs existentes
(function(){
  const dl=document.createElement('datalist');dl.id='produtos-datalist';document.body.appendChild(dl);
})();

carregarPedidos();
carregarStatus();
setInterval(carregarStatus,30000);

function notificarCliente(id){
  const card=document.getElementById(`card-${CSS.escape(id)}`);
  if(!card)return;
  const cliente=card.dataset.cliente||'';
  const telefone=card.dataset.telefone||'';
  const tbody=document.getElementById(`itens-body-${id}`);
  let itensMsg='';
  let total=0;
  if(tbody){
    tbody.querySelectorAll('tr[data-idx]').forEach(row=>{
      const nome=row.querySelector('.inp-nome')?.value||'';
      const qty=parseFloat(row.querySelector('.inp-qty')?.value)||0;
      const unit=parseFloat(row.querySelector('.inp-unit')?.value)||0;
      const sub=Math.round(qty*unit*100)/100;
      total+=sub;
      if(nome)itensMsg+=`\n• ${qty}x ${nome} = ${fmtBRL(sub)}`;
    });
  }
  const pct=parseInt(document.getElementById(`pct-${id}`)?.value)||50;
  const entrada=Math.round(total*pct/100*100)/100;
  const restante=Math.round((total-entrada)*100)/100;
  const msg=`Olá ${cliente}! 🎂\n\nAtualizamos seu pedido conforme estoque disponível:${itensMsg}\n\n💰 Total: ${fmtBRL(total)}\n💵 Entrada (${pct}%): ${fmtBRL(entrada)}${restante>0?`\n⏳ Restante na entrega: ${fmtBRL(restante)}`:''}\n\nPode confirmar este pedido atualizado? 🩷`;
  const fone=String(telefone).replace(/\D/g,'');
  window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(msg)}`,'_blank');
}

function confirmarEstoque(id){
  const card=document.getElementById(`card-${CSS.escape(id)}`);
  if(!card)return;
  const btn=card.querySelector('.btn-confirmar');
  if(btn){btn.disabled=true;btn.textContent='Processando…';}
  const telefone=card.dataset.telefone||'';
  const cliente=card.dataset.cliente||'';
  const tbody=document.getElementById(`itens-body-${id}`);
  let total=0;
  if(tbody){
    tbody.querySelectorAll('tr[data-idx]').forEach(row=>{
      const qty=parseFloat(row.querySelector('.inp-qty')?.value)||0;
      const unit=parseFloat(row.querySelector('.inp-unit')?.value)||0;
      total+=Math.round(qty*unit*100)/100;
    });
  }
  const pct=parseInt(document.getElementById(`pct-${id}`)?.value)||50;
  const entrada=Math.round(total*pct/100*100)/100;
  const url=`${WORKER}/confirmar-estoque?pedidoId=${enc(id)}&total=${enc(total)}&telefone=${enc(telefone)}&cliente=${enc(cliente)}&entrada=${enc(entrada)}`;
  window.open(url,'_blank');
  showToast('Abrindo WhatsApp com link de pagamento…');
  const ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  setTimeout(()=>{if(btn){btn.disabled=false;btn.innerHTML=ICON+' Confirmar e cobrar';}},6000);
}

// ── STATUS ───────────────────────────────────────────────────────────────────

const STATUS_OPTS = [
  'Aguardando confirmação',
  'Confirmado — Esperando pagamento',
  'Pago — Em produção',
  'Entregue — Esperando restante',
  'Finalizado',
  'Cancelado',
];
const STATUS_CLS = {
  'Aguardando confirmação':          'aguardando',
  'Confirmado — Esperando pagamento':'confirmado',
  'Pago — Em produção':              'preparo',
  'Entregue — Esperando restante':   'saiu',
  'Finalizado':                      'entregue',
  'Cancelado':                       'cancelado',
};

// Cada status agora é a sua própria aba de nível superior (igual "Estoque pendente"),
// em vez de ficarem todos agrupados dentro de uma única aba "Status dos pedidos".
function statusTabId(idx){ return 'status-'+idx; }

(function buildStatusTabs(){
  const tabsBar=document.getElementById('tabs-bar');
  const container=document.getElementById('status-tabs-container');
  STATUS_OPTS.forEach((status,idx)=>{
    const tabId=statusTabId(idx);
    const btn=document.createElement('button');
    btn.className='tab-btn';
    btn.dataset.tab=tabId;
    btn.onclick=()=>switchTab(tabId);
    btn.innerHTML=`${esc(status)} <span class="tab-count" id="count-${tabId}"></span>`;
    tabsBar.appendChild(btn);

    const pane=document.createElement('div');
    pane.className='tab-pane';
    pane.id='tab-'+tabId;
    pane.innerHTML=`<main style="padding:0 24px 40px"><div id="list-${tabId}"><div class="loading-state"><div class="spinner"></div>Carregando...</div></div></main>`;
    container.appendChild(pane);
  });
  // Aba extra de segurança — qualquer status fora da lista padrão cai aqui (não deveria
  // acontecer no fluxo normal, mas evita que um pedido "desapareça" silenciosamente).
  const btnOutros=document.createElement('button');
  btnOutros.className='tab-btn';
  btnOutros.dataset.tab='status-outros';
  btnOutros.onclick=()=>switchTab('status-outros');
  btnOutros.innerHTML=`Outros <span class="tab-count" id="count-status-outros"></span>`;
  tabsBar.appendChild(btnOutros);
  const paneOutros=document.createElement('div');
  paneOutros.className='tab-pane';
  paneOutros.id='tab-status-outros';
  paneOutros.innerHTML=`<main style="padding:0 24px 40px"><div id="list-status-outros"><div class="empty">Nenhum pedido.</div></div></main>`;
  container.appendChild(paneOutros);
})();

function switchTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab));
}

// Mapeamento Pedido Status (tabela Pedidos) → Status do admin
const PEDIDO_STATUS_MAP = {
  'Entregue':    'Entregue — Esperando restante',
};

function renderStatusList(tabId,lista,statusFixo){
  const countEl=document.getElementById('count-'+tabId);
  if(countEl)countEl.textContent=lista.length?`· ${lista.length}`:'';
  const el=document.getElementById('list-'+tabId);
  if(!el)return;
  if(!lista.length){el.innerHTML='<div class="empty"><div class="empty-icon">📭</div>Nenhum pedido aqui.</div>';return;}
  el.innerHTML=lista.map(p=>statusCardHtml(p,statusFixo||p.status||'Aguardando confirmação')).join('');
}

function statusCardHtml(p,status){
  const cls=STATUS_CLS[status]||'aguardando';
  // "Pedido Status" no Coda é multi-select → chega como array (ex: ["Entregue"]).
  const ps=Array.isArray(p.pedidoStatus)?(p.pedidoStatus[0]||''):(p.pedidoStatus||'');
  // Se o status atual for legado/desconhecido (não está em STATUS_OPTS), mostra ele
  // mesmo no topo do select — senão o dropdown mostraria a 1ª opção como "selecionada"
  // sem realmente refletir o status real do pedido (confuso).
  const statusConhecido=STATUS_OPTS.includes(status);
  const extraOpt=!statusConhecido?`<option value="${esc(status)}" selected>⚠️ ${esc(status)} (antigo)</option>`:'';
  const opts=extraOpt+STATUS_OPTS.map(s=>`<option value="${s}"${s===status?' selected':''}>${s}</option>`).join('');
  const itensResumo=(p.itens||[]).slice(0,2).map(i=>`${i.quantidade}x ${i.produto}`).join(' | ');
  const total=p.total||(p.itens||[]).reduce((s,i)=>s+(Number(i.valorItem)||0),0);
  const restante=Math.round((total-(p.valorPago||0))*100)/100;
  const podeRestante=status==='Entregue — Esperando restante'&&restante>0;
  const podePagarRetirada=status==='Confirmado — Esperando pagamento';
  return`<div class="status-card" data-rowid="${esc(p.rowId||'')}">
    <div class="sc-info">
      <div class="sc-nome">${esc(p.cliente||'—')}${p.tipoCliente==='Empresa'?' <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px;background:#dbeafe;color:#1e40af;vertical-align:middle">🏢 Empresa</span>':''}</div>
      <div class="sc-meta">📱 ${esc(p.telefone||'—')} · <b>${esc(p.entrega||'Retirada')}</b> · <b>${fmtData(p.data)}${p.hora?' às '+esc(p.hora):''}</b></div>
      <div class="sc-itens">${esc(itensResumo)}${total?` · ${fmtBRL(total)}`:''}</div>
      ${p.obs?`<div class="card-meta" style="margin-top:2px;color:var(--accent)">📝 ${esc(p.obs)}</div>`:''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px">
        <span class="sc-badge ${cls}">${status}</span>
        ${ps?`<span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;background:${ps==='Entregue'?'#d1fae5':'#fef3c7'};color:${ps==='Entregue'?'#065f46':'#92400e'}">📦 ${esc(ps)}</span>`:''}
      </div>
      ${podeRestante?`<button class="btn-cobrar-restante" onclick="cobrarRestante('${esc(p.idPedido)}','${esc(p.telefone)}','${esc(p.cliente)}')">💳 Cobrar restante · ${fmtBRL(restante)}</button>`:''}
      ${podePagarRetirada?`<button class="btn-pagar-retirada" onclick="abrirConfirmPagarRetirada('${esc(p.rowId)}','${esc(p.cliente)}','${esc(p.telefone)}',this)">💵 Pagar na Retirada</button>`:''}
    </div>
    <div class="sc-actions">
      <select class="status-select" onchange="atualizarStatus('${esc(p.rowId)}',this)">${opts}</select>
      <div class="sc-actions-row">
        ${status!=='Finalizado'?`<button class="btn-finalizar" onclick="abrirConfirmFinalizar('${esc(p.rowId)}','${esc(p.cliente)}',this)">✅ Finalizar</button>`:''}
        <button class="btn-apagar" onclick="abrirConfirmApagar('${esc(p.rowId)}','${esc(p.cliente)}',this)">🗑️ Apagar</button>
      </div>
    </div>
  </div>`;
}

async function carregarStatus(){
  try{
    const res=await fetch(`${WORKER}/pedidos-pendentes?todos=1`);
    const data=await res.json();
    const pedidos=data.pedidos||[];

    // Auto-atualiza status baseado em Pedido Status da tabela Pedidos
    for(const p of pedidos){
      const ps=p.pedidoStatus||'';
      const novoStatus=PEDIDO_STATUS_MAP[ps];
      // "Finalizado" é um estado final — uma vez finalizado manualmente (ex: pago
      // por fora, sem Infinite Pay), nunca mais reescreve automaticamente com base
      // no "Pedido Status" (era esse o motivo do status voltar pro anterior).
      if(novoStatus && p.status!==novoStatus && p.status!=='Finalizado' && p.rowId){
        p.status=novoStatus; // atualiza localmente para renderizar certo
        fetch(`${WORKER}/atualizar-status`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({rowId:p.rowId,status:novoStatus})
        }).catch(()=>{});
      }
    }

    // Agrupa os pedidos por status
    const grupos={};
    pedidos.forEach(p=>{
      const status=p.status||'Aguardando confirmação';
      (grupos[status]=grupos[status]||[]).push(p);
    });

    // Renderiza cada status na sua própria aba
    STATUS_OPTS.forEach((status,idx)=>{
      renderStatusList(statusTabId(idx),grupos[status]||[],status);
    });

    // Qualquer status fora da lista padrão cai na aba "Outros"
    const outros=Object.keys(grupos).filter(s=>!STATUS_OPTS.includes(s)).flatMap(s=>grupos[s]);
    renderStatusList('status-outros',outros,null);

    tentarDeepLink();
  }catch(e){
    showToast('Erro ao carregar status: '+e.message);
  }
}

function cobrarRestante(pedidoId,telefone,cliente){
  const url=`${WORKER}/cobrar-restante?pedidoId=${enc(pedidoId)}&telefone=${enc(telefone)}&cliente=${enc(cliente)}`;
  window.open(url,'_blank');
  showToast('Abrindo WhatsApp com link do restante…');
}

async function atualizarStatus(rowId,sel){
  const novoStatus=sel.value;
  sel.disabled=true;
  try{
    await fetch(`${WORKER}/atualizar-status`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rowId,status:novoStatus})
    });
    showToast('Status atualizado: '+novoStatus);
    // Recarrega a lista pra mover o card pro grupo correto (pedidos são agrupados por status)
    carregarStatus();
  }catch(e){
    showToast('Erro ao atualizar: '+e.message);
    sel.disabled=false;
  }
}

// ── FINALIZAR / APAGAR PEDIDO — modal de confirmação compartilhado ──────────
let _pendingAction=null,_actionRowId=null,_actionBtnEl=null,_actionTelefone=null;

function abrirConfirmFinalizar(rowId,nomeCliente,btnEl){
  _pendingAction='finalizar';_actionRowId=rowId;_actionBtnEl=btnEl;
  document.getElementById('confirm-icon').textContent='✅';
  document.getElementById('confirm-title').textContent='Finalizar pedido?';
  document.getElementById('confirm-msg').innerHTML=`Marcar o pedido de <b>${esc(nomeCliente||'cliente')}</b> como <b>Finalizado</b>?<br>Use isso quando o pagamento foi feito por fora (sem o Infinite Pay).`;
  document.getElementById('confirm-ok-btn').textContent='Sim, finalizar';
  document.getElementById('confirm-overlay').classList.add('open');
}
function abrirConfirmApagar(rowId,nomeCliente,btnEl){
  if(!rowId){showToast('Pedido ainda não tem linha no Coda — não dá pra apagar.');return;}
  _pendingAction='apagar';_actionRowId=rowId;_actionBtnEl=btnEl;
  document.getElementById('confirm-icon').textContent='🗑️';
  document.getElementById('confirm-title').textContent='Apagar pedido?';
  document.getElementById('confirm-msg').innerHTML=`Apagar definitivamente o pedido de <b>${esc(nomeCliente||'cliente')}</b>?<br>Isso também apaga a linha no Coda. Essa ação não pode ser desfeita.`;
  document.getElementById('confirm-ok-btn').textContent='Sim, apagar';
  document.getElementById('confirm-overlay').classList.add('open');
}
function closeConfirm(){
  document.getElementById('confirm-overlay').classList.remove('open');
  _pendingAction=null;_actionRowId=null;_actionBtnEl=null;
}
function _confirmOk(){
  if(_pendingAction==='finalizar')return _confirmFinalizarOk();
  if(_pendingAction==='apagar')return _confirmApagarOk();
  if(_pendingAction==='pagar-retirada')return _confirmPagarRetiradaOk();
}
async function _confirmFinalizarOk(){
  if(!_actionRowId)return;
  const okBtn=document.getElementById('confirm-ok-btn');
  okBtn.disabled=true;okBtn.textContent='Finalizando...';
  const rowId=_actionRowId;
  try{
    await fetch(`${WORKER}/atualizar-status`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rowId,status:'Finalizado'})
    });
    showToast('Pedido finalizado ✅');
    // Recarrega a lista pra mover o card pro grupo "Finalizado"
    carregarStatus();
  }catch(e){
    showToast('Erro ao finalizar: '+e.message);
  }finally{
    okBtn.disabled=false;
    closeConfirm();
  }
}
async function _confirmApagarOk(){
  if(!_actionRowId)return;
  const okBtn=document.getElementById('confirm-ok-btn');
  okBtn.disabled=true;okBtn.textContent='Apagando...';
  const rowId=_actionRowId;
  try{
    const res=await fetch(`${WORKER}/apagar-pedido`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rowId})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false)throw new Error(data.error||'Falha ao apagar no Coda');
    showToast('Pedido apagado 🗑️');
    // Recarrega as duas listas — o pedido pode estar visível em Estoque e/ou Status
    carregarStatus();
    carregarPedidos();
  }catch(e){
    showToast('Erro ao apagar: '+e.message);
  }finally{
    okBtn.disabled=false;
    closeConfirm();
  }
}

function abrirConfirmPagarRetirada(rowId,nomeCliente,telefone,btnEl){
  _pendingAction='pagar-retirada';_actionRowId=rowId;_actionBtnEl=btnEl;_actionTelefone=telefone;
  document.getElementById('confirm-icon').textContent='💵';
  document.getElementById('confirm-title').textContent='Pagar na retirada?';
  document.getElementById('confirm-msg').innerHTML=`Confirmar para <b>${esc(nomeCliente||'cliente')}</b> que o pagamento será feito na hora da retirada?<br>Um aviso será enviado pelo WhatsApp.`;
  document.getElementById('confirm-ok-btn').textContent='Sim, confirmar';
  document.getElementById('confirm-overlay').classList.add('open');
}
async function _confirmPagarRetiradaOk(){
  if(!_actionRowId)return;
  const okBtn=document.getElementById('confirm-ok-btn');
  okBtn.disabled=true;okBtn.textContent='Processando...';
  const rowId=_actionRowId;
  const telefone=_actionTelefone||'';
  try{
    const res=await fetch(`${WORKER}/pagar-na-retirada`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({rowId})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false)throw new Error(data.error||'Falha ao processar');
    const nome=data.nome||'cliente';
    const whatsapp=String(data.whatsapp||telefone).replace(/\D/g,'');
    const fone=whatsapp.startsWith('55')?whatsapp:'55'+whatsapp;
    const msg=`Olá ${nome}! Confirmamos seu pedido. Pode pagar na hora da retirada. 🎉`;
    window.open(`https://wa.me/${fone}?text=${encodeURIComponent(msg)}`,'_blank');
    showToast('Confirmado! WhatsApp aberto 💵');
    carregarStatus();
  }catch(e){
    showToast('Erro: '+e.message);
  }finally{
    okBtn.disabled=false;
    closeConfirm();
  }
}

