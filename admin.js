
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
// id/nome → Tipo do produto (Salgado Frito, Assado, Doce...) — usado só pra agrupar os
// itens do modal "Detalhes/Imprimir" por categoria (ver agruparItensPorTipo()).
let _produtosTipoPorId   = {};
let _produtosTipoPorNome = {};
// nome → id do produto — usado pra recuperar o Row ID Produto quando o admin troca/adiciona
// um item pelo select (que só carrega o NOME), assim a categoria continua batendo certo
// depois de editado (ver agruparItensPorTipo/salvarDetalhesPedido).
let _produtosIdPorNome = {};

// Carrega o catálogo de produtos (usado nos selects) e recarrega os pedidos.
// A lista de pedidos em si vem SEMPRE de carregarStatus() — fetch ÚNICO que
// alimenta a aba "Estoque pendente" E as abas de status ao mesmo tempo, com
// partição exclusiva por rowId. Antes eram dois fetches independentes (e só o
// de status rodava no polling de 30s): a aba Estoque ficava desatualizada e o
// mesmo pedido aparecia em duas abas com "status" divergentes.
async function carregarPedidos(){
  const btn=document.getElementById('btn-refresh');
  btn.classList.add('loading');btn.disabled=true;
  try{
    const prodData=await fetch(`${WORKER}/produtos?todos=1`).then(r=>r.json()).catch(()=>({produtos:[]}));
    const lista=prodData.produtos||[];
    _produtosList=lista.map(p=>p.nome);
    _produtosMap=Object.fromEntries(lista.map(p=>[p.nome,p.valorUnit]));
    _produtosTipoPorId=Object.fromEntries(lista.filter(p=>p.tipo).map(p=>[p.id,p.tipo]));
    _produtosTipoPorNome=Object.fromEntries(lista.filter(p=>p.tipo).map(p=>[String(p.nome||'').toLowerCase(),p.tipo]));
    _produtosIdPorNome=Object.fromEntries(lista.map(p=>[String(p.nome||'').toLowerCase(),p.id]));
    const dl=document.getElementById('produtos-datalist');
    if(dl)dl.innerHTML=_produtosList.map(n=>`<option value="${esc(n)}">`).join('');
    _estoqueSig=null; // refresh manual força re-render da aba Estoque
    await carregarStatus();
  }catch(e){
    document.getElementById('main').innerHTML=`<div class="empty"><div class="empty-icon">⚠️</div>Erro ao carregar pedidos.<br><small>${e.message}</small></div>`;
  }finally{
    btn.classList.remove('loading');btn.disabled=false;
  }
}

function renderPedidos(pedidos){
  const countEl=document.getElementById('count-estoque');
  if(countEl)countEl.textContent=pedidos.length?`· ${pedidos.length}`:'';
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
  // id 'edit' = modal "Editar itens"; 'manual' = modal "Pedido manual"; 'detalhe' = modal
  // "Detalhes" (edição completa); qualquer outro id é card da aba Estoque (tbody itens-body-<id>).
  if(id==='edit'){recalcEdit();}else if(id==='manual'){recalcManual();}else if(id==='detalhe'){recalcDetalheItens();}else{recalcCard(id);}
}

const IS='border:1px solid #e8e0d8;border-radius:6px;padding:4px 6px;font-size:13px;font-family:inherit;background:#fff;';

// ── MENU "MAIS AÇÕES" (☰) ────────────────────────────────────────────────────
// Card com muitos botões (Confirmar, Editar itens, Avisar cliente, Cobrar, Apagar...)
// ficava poluído — só "Detalhes" e o ☰ ficam sempre visíveis; o resto mora aqui dentro.
const ICON_MENU='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';

function toggleCardMenu(btn){
  const dd=btn.closest('.card-menu-wrap')?.querySelector('.card-menu-dropdown');
  if(!dd)return;
  const wasOpen=dd.classList.contains('open');
  closeAllCardMenus();
  if(!wasOpen)dd.classList.add('open');
}
function closeAllCardMenus(){
  document.querySelectorAll('.card-menu-dropdown.open').forEach(el=>el.classList.remove('open'));
}
// Clique fora de qualquer menu aberto fecha todos (padrão dropdown/kebab menu).
document.addEventListener('click',(e)=>{
  if(!e.target.closest('.card-menu-wrap'))closeAllCardMenus();
});

function cardPedido(p){
  const id=p.idPedido;
  const st=p.status||'Aguardando confirmação';
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
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <span class="badge">${esc(st)}</span>
        ${p.rowId?buildStatusSelect(p.rowId,st):''}
      </div>
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
      <button class="btn-detalhes" onclick="abrirDetalhesPedido('${esc(p.rowId||'')}')">
        📋 Detalhes/Imprimir
      </button>
      <div class="card-menu-wrap">
        <button class="card-menu-btn" onclick="toggleCardMenu(this)" title="Mais ações">${ICON_MENU}</button>
        <div class="card-menu-dropdown">
          <button class="btn-confirmar" onclick="closeAllCardMenus();confirmarEstoque('${esc(id)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Confirmar e cobrar
          </button>
          <button class="btn-editar-itens" onclick="closeAllCardMenus();abrirEditItens('${esc(p.rowId||'')}')">
            ✏️ Editar itens
          </button>
          <button onclick="closeAllCardMenus();notificarCliente('${esc(id)}')" style="background:none;border:1.5px solid #25d366;border-radius:var(--radius-sm);padding:10px 14px;font-size:13px;font-weight:600;color:#128c7e;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;white-space:nowrap">
            📱 Avisar cliente
          </button>
          <button class="btn-apagar" onclick="closeAllCardMenus();abrirConfirmApagar('${esc(p.rowId||'')}','${esc(p.cliente)}',this)">
            🗑️ Apagar
          </button>
        </div>
      </div>
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

// ── DETALHES DO PEDIDO (itens agrupados por categoria) + IMPRESSÃO ──────────
// "Categoria" = coluna Tipo dos Produtos Site (Salgado Frito, Assado, Doce...).

const SEM_CATEGORIA = 'Outros';

// Mesma lógica de agrupamento que o worker já usa em pbCriarRowFila() pro texto da
// Fila Cozinha: casa primeiro por rowIdProduto (sobrevive a rename do produto), cai
// pro nome, e sem achar nenhum dos dois joga em "Outros" em vez de sumir do pedido.
// Taxa de entrega (produto começando com 🛵) fica de fora do agrupamento — sempre
// mostrada à parte, como já era no card de edição de itens.
function agruparItensPorTipo(itens){
  const grupos=new Map();
  (itens||[]).forEach(i=>{
    if(String(i.produto||'').startsWith('🛵'))return;
    const nomeBusca=String(i.produto||'').replace(/^🎀 Topper — /,'').toLowerCase();
    const tipo=_produtosTipoPorId[i.rowIdProduto]||_produtosTipoPorNome[nomeBusca]||SEM_CATEGORIA;
    if(!grupos.has(tipo))grupos.set(tipo,[]);
    grupos.get(tipo).push(i);
  });
  return Array.from(grupos.entries()).map(([tipo,itensDoTipo])=>({tipo,itens:itensDoTipo}));
}

let _detalhesRowId=null;
let _detalhesSnap=null; // estado no momento de abrir — usado só pra montar o resumo de alterações

function maskPhoneAdmin(input){
  let v=input.value.replace(/\D/g,'');
  if((v.length===12||v.length===13)&&v.startsWith('55'))v=v.slice(2);
  if(v.length>11)v=v.slice(0,11);
  if(v.length<=10){v=v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3');}
  else{v=v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');}
  input.value=v.replace(/-$/,'');
}

function abrirDetalhesPedido(rowId){
  const p=_pedidosCache[rowId];
  if(!p){showToast('Pedido não encontrado — atualize a lista');return;}
  _detalhesRowId=rowId;
  const itensEditaveis=(p.itens||[]).filter(i=>!String(i.produto||'').startsWith('🛵'));
  const taxaItem=(p.itens||[]).find(i=>String(i.produto||'').startsWith('🛵'));
  _detalhesSnap={
    cliente:p.cliente||'',telefone:p.telefone||'',entrega:p.entrega||'',endereco:p.endereco||'',
    pagamento:p.pagamento||'',data:p.data||'',hora:p.hora||'',obs:p.obs||'',
    taxa:taxaItem?Number(taxaItem.valorItem||taxaItem.valorUnit||0):0,
    itens:itensEditaveis.map(i=>({produto:String(i.produto||'').trim(),quantidade:Number(i.quantidade||1),valorUnit:Number(i.valorUnit||0)})),
  };
  const isEntrega=p.entrega==='Entrega em endereço';
  const pagamentosPadrao=['PIX','Cartão de crédito','Cartão de débito','Dinheiro'];
  const pagamentoAtual=p.pagamento||'';
  document.getElementById('detalhes-body').innerHTML=`
    <div class="manual-grid">
      <label>Cliente<input id="dt-cliente" value="${esc(p.cliente||'')}"></label>
      <label>WhatsApp<input id="dt-tel" value="${esc(p.telefone||'')}" oninput="maskPhoneAdmin(this)"></label>
      <label>Entrega
        <select id="dt-entrega" onchange="_dtToggleEndereco()">
          <option value="Retirada no local" ${!isEntrega?'selected':''}>🏪 Retirada no local</option>
          <option value="Entrega em endereço" ${isEntrega?'selected':''}>🛵 Entrega em endereço</option>
        </select>
      </label>
      <label id="dt-end-wrap" style="display:${isEntrega?'flex':'none'};grid-column:1/-1">Endereço<input id="dt-endereco" value="${esc(p.endereco||'')}"></label>
      <label>Pagamento
        <select id="dt-pagamento">
          ${pagamentosPadrao.map(op=>`<option ${pagamentoAtual===op?'selected':''}>${op}</option>`).join('')}
          ${pagamentoAtual&&!pagamentosPadrao.includes(pagamentoAtual)?`<option selected>${esc(pagamentoAtual)}</option>`:''}
        </select>
      </label>
      <label>Data<input id="dt-data" type="date" value="${esc(p.data||'')}"></label>
      <label>Hora<input id="dt-hora" type="time" value="${esc(p.hora||'')}"></label>
    </div>
    <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;margin-bottom:12px">Observações
      <textarea id="dt-obs" rows="2" style="border:1px solid #e8e0d8;border-radius:6px;padding:7px 8px;font-size:13px;font-family:inherit;background:#fff;color:var(--text);resize:vertical">${esc(p.obs||'')}</textarea>
    </label>
    <div class="itens-titulo" style="margin:4px 0 6px">Itens</div>
    <div class="itens-table-wrap">
      <table style="width:100%;border-collapse:collapse">
        <tbody id="detalhes-itens-body"></tbody>
      </table>
    </div>
    <button type="button" onclick="addDetalheItem()" class="edit-add-btn">+ Adicionar item</button>
    <div class="edit-frete-row">
      <label for="dt-frete">🛵 Taxa de entrega (R$)</label>
      <input id="dt-frete" type="number" min="0" step="0.01" value="${_detalhesSnap.taxa.toFixed(2)}" oninput="recalcDetalheItens()">
    </div>
    <div class="detalhes-totais">
      <div>Pago: <b>${fmtBRL(p.valorPago||0)}</b></div>
      <div class="tot-final">Total: <span id="detalhes-total-live">${fmtBRL(p.total||0)}</span></div>
    </div>
  `;
  // Cabeçalho de categoria + linhas do grupo, tudo na mesma tbody (mantém o agrupamento
  // visual já usado no resto do admin/painel, mas agora com botão de editar por item).
  const grupos=agruparItensPorTipo(itensEditaveis);
  const tbody=document.getElementById('detalhes-itens-body');
  grupos.forEach(g=>{
    const trCat=document.createElement('tr');
    trCat.innerHTML=`<td colspan="5" style="padding-top:12px"><div class="detalhes-cat-title" style="margin:0 0 4px">${esc(g.tipo)}</div></td>`;
    tbody.appendChild(trCat);
    g.itens.forEach(i=>tbody.appendChild(buildDetalheItemRow(i)));
  });
  if(!itensEditaveis.length)addDetalheItem();
  _dtToggleEndereco();
  document.getElementById('detalhes-overlay').classList.add('open');
}

function _dtToggleEndereco(){
  const sel=document.getElementById('dt-entrega');
  const wrap=document.getElementById('dt-end-wrap');
  if(sel&&wrap)wrap.style.display=sel.value==='Entrega em endereço'?'flex':'none';
}

// Cada linha nasce em modo "visualização" (texto + preço + ✏️) — só vira um formulário
// editável (select de produto/qtd/valor) quando o ✏️ é clicado. É o "botão de edição por
// item": dá pra conferir o pedido inteiro rapidinho e editar só o que precisar.
function buildDetalheItemRow(i){
  const tr=document.createElement('tr');
  tr.dataset.produto=(i&&i.produto)||'';
  tr.dataset.qty=i?(i.quantidade||1):1;
  tr.dataset.unit=i?Number(i.valorUnit||0):0;
  tr.dataset.recheios=(i&&i.recheios)||'';
  tr.dataset.topoinfo=(i&&i.topoInfo)||'';
  tr.style.borderTop='1px solid var(--border)';
  renderDetalheItemView(tr);
  return tr;
}

function renderDetalheItemView(tr){
  const qty=tr.dataset.qty,unit=Number(tr.dataset.unit)||0,nome=tr.dataset.produto,rech=tr.dataset.recheios;
  const sub=Math.round((parseFloat(qty)||0)*unit*100)/100;
  tr.innerHTML=`
    <td colspan="3" style="padding:6px 0;font-size:13.5px">
      <span style="color:var(--text3);margin-right:6px">${qty}x</span>${esc(nome)}${rech?` <span style="color:var(--text3);font-size:12px">(${esc(rech)})</span>`:''}
    </td>
    <td style="padding:6px 0;text-align:right;font-size:13px;font-weight:600;white-space:nowrap">${fmtBRL(sub)}</td>
    <td style="padding:6px 0 6px 8px;text-align:right">
      <button type="button" onclick="renderDetalheItemEdit(this.closest('tr'))" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;padding:0" title="Editar item">✏️</button>
    </td>`;
}

function renderDetalheItemEdit(tr){
  tr.innerHTML=`
    <td style="padding:6px 0">${buildProdutoSelect('detalhe',tr.dataset.produto)}</td>
    <td style="padding:6px 4px;text-align:center"><input class="inp-qty" type="number" value="${tr.dataset.qty}" min="0.1" step="0.1" oninput="recalcDetalheItens()" style="${IS}width:52px;text-align:center"></td>
    <td style="padding:6px 4px;text-align:center"><input class="inp-unit" type="number" value="${Number(tr.dataset.unit).toFixed(2)}" min="0" step="0.01" oninput="recalcDetalheItens()" style="${IS}width:72px;text-align:center"></td>
    <td class="td-sub" style="padding:6px 0 6px 4px;text-align:right;font-size:13px;font-weight:600">${fmtBRL((parseFloat(tr.dataset.qty)||0)*(Number(tr.dataset.unit)||0))}</td>
    <td style="padding:6px 0 6px 8px"><button type="button" onclick="this.closest('tr').remove();recalcDetalheItens()" style="background:none;border:none;cursor:pointer;color:#c0725a;font-size:18px;line-height:1;padding:0" title="Remover">×</button></td>`;
  recalcDetalheItens();
}

function addDetalheItem(){
  const tbody=document.getElementById('detalhes-itens-body');
  if(!tbody)return;
  const tr=buildDetalheItemRow(null);
  renderDetalheItemEdit(tr); // item novo já nasce editável — não faz sentido "ver" um item vazio
  tbody.appendChild(tr);
}

function recalcDetalheItens(){
  let total=0;
  document.querySelectorAll('#detalhes-itens-body tr').forEach(tr=>{
    const qtyInp=tr.querySelector('.inp-qty'),unitInp=tr.querySelector('.inp-unit');
    let qty,unit;
    if(qtyInp&&unitInp){
      qty=parseFloat(qtyInp.value)||0;unit=parseFloat(unitInp.value)||0;
      const td=tr.querySelector('.td-sub');
      if(td)td.textContent=fmtBRL(Math.round(qty*unit*100)/100);
    }else if(tr.dataset.qty!==undefined){
      qty=parseFloat(tr.dataset.qty)||0;unit=parseFloat(tr.dataset.unit)||0;
    }else{
      return; // linha de cabeçalho de categoria — sem qty/unit
    }
    total+=Math.round(qty*unit*100)/100;
  });
  total+=parseFloat(document.getElementById('dt-frete')?.value)||0;
  const el=document.getElementById('detalhes-total-live');
  if(el)el.textContent=fmtBRL(Math.round(total*100)/100);
}

function closeDetalhesModal(){
  document.getElementById('detalhes-overlay').classList.remove('open');
  _detalhesRowId=null;_detalhesSnap=null;
}

// Lê o estado ATUAL do modal (campos do pedido + itens — linha em modo visualização usa o
// dataset, linha em edição usa os inputs) num objeto normalizado. Usado tanto por
// salvarDetalhesPedido() quanto por imprimirDetalhesPedido() — a impressão sempre reflete
// o que está na tela, mesmo com edições ainda não salvas.
function _coletarEstadoDetalhes(){
  const itens=[];
  document.querySelectorAll('#detalhes-itens-body tr').forEach(tr=>{
    const qtyInp=tr.querySelector('.inp-qty'),unitInp=tr.querySelector('.inp-unit');
    let produto,qty,unit,recheios,topoInfo;
    if(qtyInp&&unitInp){
      const sel=tr.querySelector('select,.inp-nome');
      produto=sel?String(sel.value||'').trim():'';
      if(produto==='__outro__')produto='';
      qty=parseFloat(qtyInp.value)||0;
      unit=parseFloat(unitInp.value)||0;
      recheios=tr.dataset.recheios||'';
      topoInfo=tr.dataset.topoinfo||'';
    }else if(tr.dataset.produto!==undefined){
      produto=tr.dataset.produto;
      qty=parseFloat(tr.dataset.qty)||0;
      unit=parseFloat(tr.dataset.unit)||0;
      recheios=tr.dataset.recheios||'';
      topoInfo=tr.dataset.topoinfo||'';
    }else{
      return; // cabeçalho de categoria
    }
    if(!produto||qty<=0)return;
    const nomeBusca=String(produto).replace(/^🎀 Topper — /,'').toLowerCase();
    itens.push({
      produto,quantidade:qty,valorUnit:unit,valorItem:Math.round(qty*unit*100)/100,
      recheios,topoInfo,rowIdProduto:_produtosIdPorNome[nomeBusca]||'',
    });
  });
  const taxa=Math.max(0,parseFloat(document.getElementById('dt-frete')?.value)||0);
  const total=Math.round((itens.reduce((s,i)=>s+i.valorItem,0)+taxa)*100)/100;
  return{
    cliente:(document.getElementById('dt-cliente')?.value||'').trim(),
    telefone:(document.getElementById('dt-tel')?.value||'').trim(),
    entrega:document.getElementById('dt-entrega')?.value||'',
    endereco:(document.getElementById('dt-endereco')?.value||'').trim(),
    pagamento:document.getElementById('dt-pagamento')?.value||'',
    data:document.getElementById('dt-data')?.value||'',
    hora:document.getElementById('dt-hora')?.value||'',
    obs:(document.getElementById('dt-obs')?.value||'').trim(),
    itens,taxa,total,
  };
}

// Resumo legível de tudo que mudou (campos do pedido + itens/taxa) — vira o texto do
// aviso Telegram/cliente. Comparação de itens é por descrição ordenada (simples, mas
// suficiente pra decidir SE mudou algo e mostrar antes/depois pro atendente conferir).
function _montarResumoDetalhes(estado){
  const partes=[];
  const campos=[
    ['cliente','Cliente'],['telefone','WhatsApp'],['entrega','Entrega'],['endereco','Endereço'],
    ['pagamento','Pagamento'],['data','Data'],['hora','Hora'],['obs','Observações'],
  ];
  campos.forEach(([chave,rotulo])=>{
    const antes=String(_detalhesSnap[chave]||'').trim();
    const depois=String(estado[chave]||'').trim();
    if(antes!==depois)partes.push(`${rotulo}: ${antes||'—'} → ${depois||'—'}`);
  });
  const descreve=i=>`${_fmtQty(i.quantidade)}x ${i.produto} (${fmtBRL(i.valorUnit)})`;
  const itensAntes=(_detalhesSnap.itens||[]).map(descreve).sort().join(' | ');
  const itensDepois=estado.itens.map(descreve).sort().join(' | ');
  if(itensAntes!==itensDepois)partes.push(`Itens:\nAntes: ${itensAntes||'—'}\nDepois: ${itensDepois||'—'}`);
  if(Math.round(Number(_detalhesSnap.taxa)*100)!==Math.round(Number(estado.taxa)*100)){
    partes.push(`🛵 Taxa de entrega: ${fmtBRL(_detalhesSnap.taxa)} → ${fmtBRL(estado.taxa)}`);
  }
  if(!partes.length)return '';
  return `Pedido de ${estado.cliente||_detalhesSnap.cliente||'—'}\n`+partes.join('\n');
}

async function salvarDetalhesPedido(){
  const p=_pedidosCache[_detalhesRowId];
  if(!p){closeDetalhesModal();return;}
  const estado=_coletarEstadoDetalhes();
  if(!estado.itens.length){showToast('O pedido precisa de pelo menos 1 item.');return;}
  if(!estado.cliente){showToast('Informe o nome do cliente.');return;}
  const alteracoesResumo=_montarResumoDetalhes(estado);
  const notificar=!!alteracoesResumo;
  const ctx=[
    {column:'Cliente',value:estado.cliente},
    {column:'WhatsApp',value:estado.telefone},
    {column:'Entrega',value:estado.entrega},
    {column:'Pagamento',value:estado.pagamento},
    {column:'Data Desejada',value:estado.data},
    {column:'Hora',value:estado.hora},
  ];
  const subrows=estado.itens.map(i=>[
    {column:'Produto',value:i.produto},
    {column:'Quantidade',value:i.quantidade},
    {column:'Valor Unit',value:i.valorUnit},
    ...(i.rowIdProduto?[{column:'Row ID Produto',value:i.rowIdProduto}]:[]),
    ...(i.recheios?[{column:'Recheios',value:i.recheios}]:[]),
    ...(i.topoInfo?[{column:'Topo Info',value:i.topoInfo}]:[]),
    ...ctx,
  ]);
  const pai=[
    {column:'Total',value:estado.total},
    {column:'Cliente',value:estado.cliente},
    {column:'WhatsApp',value:estado.telefone},
    {column:'Entrega',value:estado.entrega},
    {column:'Endereço',value:estado.entrega==='Entrega em endereço'?estado.endereco:''},
    {column:'Pagamento',value:estado.pagamento},
    {column:'Data Desejada',value:estado.data},
    {column:'Hora',value:estado.hora},
    {column:'Observações',value:estado.obs},
  ];
  const btn=document.getElementById('detalhes-save-btn');
  if(btn){btn.disabled=true;btn.textContent='Salvando...';}
  try{
    const res=await fetch(`${WORKER}/editar-pedido`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({paiId:_detalhesRowId,pai,subrows,taxaFrete:estado.taxa,origem:'admin',alteracoesResumo,notificar})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||d.ok===false)throw new Error(d.error||'Falha ao salvar no Coda');
    const novoTotal=(d.novoTotal!=null)?d.novoTotal:estado.total;
    const aviso=notificar?' · cliente e Telegram avisados':' · nenhuma alteração a comunicar';
    showToast(`Pedido atualizado ✅ Novo total: ${fmtBRL(novoTotal)}${(d.reembolso||0)>0?` · reembolso devido: ${fmtBRL(d.reembolso)}`:''}${aviso}`);
    closeDetalhesModal();
    _estoqueSig=null;
    carregarStatus();
  }catch(e){
    showToast('Erro ao salvar: '+e.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='💾 Salvar alterações';}
  }
}

// Recibo térmico — mesmo layout/CSS (#print-area, classes p-*) do painel-pedidos.js.
// Lê do estado ATUAL do modal (não do cache) — reflete edições ainda não salvas.
function imprimirDetalhesPedido(){
  const estado=_coletarEstadoDetalhes();
  if(!estado.itens.length)return;
  const grupos=agruparItensPorTipo(estado.itens);
  const itensHtml=grupos.map(g=>`
    <div class="p-section">${esc(g.tipo)}</div>
    ${g.itens.map(i=>`<div class="p-item">${i.quantidade}x ${esc(i.produto)}${i.recheios?` (${esc(i.recheios)})`:''}</div>`).join('')}
  `).join('');
  const isEntrega=estado.entrega==='Entrega em endereço';
  document.getElementById('print-area').innerHTML=`
    <div class="p-logo">D'Luh Festas 🍰</div>
    <div class="p-sub">Salgados &amp; Doces para festas</div>
    <div class="p-div"></div>
    <div class="p-row"><span class="p-label">Cliente:</span><span>${esc(estado.cliente)}</span></div>
    <div class="p-row"><span class="p-label">Fone:</span><span>${esc(estado.telefone||'—')}</span></div>
    <div class="p-row"><span class="p-label">Tipo:</span><span>${isEntrega?'🛵 ENTREGA':'🛍️ RETIRADA'}</span></div>
    ${estado.endereco?`<div class="p-row"><span class="p-label">Endereço:</span><span>${esc(estado.endereco)}</span></div>`:''}
    <div class="p-row"><span class="p-label">Data/Hora:</span><span>${fmtData(estado.data)}${estado.hora?' '+esc(estado.hora):''}</span></div>
    <div class="p-div"></div>
    <div class="p-section">PEDIDO:</div>
    ${itensHtml}
    ${estado.taxa>0?`<div class="p-item">🛵 Taxa de entrega</div>`:''}
    <div class="p-div"></div>
    <div class="p-total">Total: ${esc(fmtBRL(estado.total))}</div>
    ${estado.obs?`<div class="p-div"></div><div class="p-item">Obs: ${esc(estado.obs)}</div>`:''}
    <div class="p-div"></div>
    <div class="p-footer">D'Luh Festas agradece seu pedido! ❤️</div>
  `;
  setTimeout(()=>window.print(),100);
}

// datalist para autocomplete nos inputs existentes (fallback — hoje o elemento
// já vem no admin.html; só cria se não existir, senão duplicaria o ID)
(function(){
  if(document.getElementById('produtos-datalist'))return;
  const dl=document.createElement('datalist');dl.id='produtos-datalist';document.body.appendChild(dl);
})();

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

// Status que pertencem à aba "Estoque pendente" (pré-confirmação). Um pedido
// nesses status NÃO aparece nas abas de status — partição exclusiva, sem duplicata.
const ESTOQUE_STATUS = ['', 'Aguardando confirmação', 'Verificando Estoque'];

// Cache do último carregamento (rowId → pedido) — usado pelo modal "Editar itens".
let _pedidosCache = {};
// Assinatura da aba Estoque: o poll de 30s só re-renderiza os cards (e apaga uma
// edição inline em andamento) se a lista realmente mudou no Coda.
let _estoqueSig = null;

// Select de status compartilhado (aba Estoque + abas de status). Status
// legado/desconhecido aparece selecionado mas DESABILITADO: dá pra ver qual é,
// mas nunca re-escrever no Coda uma string fora do ciclo canônico.
function buildStatusSelect(rowId,status){
  const statusConhecido=STATUS_OPTS.includes(status);
  const extraOpt=(!statusConhecido&&status)?`<option value="${esc(status)}" selected disabled>⚠️ ${esc(status)} (antigo)</option>`:'';
  const opts=extraOpt+STATUS_OPTS.map(s=>`<option value="${s}"${s===status?' selected':''}>${s}</option>`).join('');
  return `<select class="status-select" onchange="atualizarStatus('${esc(rowId)}',this)">${opts}</select>`;
}

function renderStatusList(tabId,lista,statusFixo,emptyMsg){
  const countEl=document.getElementById('count-'+tabId);
  if(countEl)countEl.textContent=lista.length?`· ${lista.length}`:'';
  const el=document.getElementById('list-'+tabId);
  if(!el)return;
  if(!lista.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📭</div>${emptyMsg||'Nenhum pedido aqui.'}</div>`;return;}
  el.innerHTML=lista.map(p=>statusCardHtml(p,statusFixo||p.status||'Aguardando confirmação')).join('');
}

function statusCardHtml(p,status){
  const cls=STATUS_CLS[status]||'aguardando';
  // "Pedido Status" no Coda é multi-select → chega como array (ex: ["Entregue"]).
  const psArr=Array.isArray(p.pedidoStatus)?p.pedidoStatus:(p.pedidoStatus?[p.pedidoStatus]:[]);
  const ps=psArr.filter(Boolean).join(', ');
  const psEntregue=psArr.includes('Entregue');
  const itensResumo=(p.itens||[]).slice(0,2).map(i=>`${i.quantidade}x ${i.produto}`).join(' | ');
  const total=p.total||(p.itens||[]).reduce((s,i)=>s+(Number(i.valorItem)||0),0);
  const restante=Math.round((total-(p.valorPago||0))*100)/100;
  const podeRestante=status==='Entregue — Esperando restante'&&restante>0;
  const podePagarRetirada=status==='Confirmado — Esperando pagamento';
  const podeMarcarEntregue=!['Entregue — Esperando restante','Finalizado','Cancelado'].includes(status);
  return`<div class="status-card" data-rowid="${esc(p.rowId||'')}">
    <div class="sc-info">
      <div class="sc-nome">${esc(p.cliente||'—')}${p.tipoCliente==='Empresa'?' <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px;background:#dbeafe;color:#1e40af;vertical-align:middle">🏢 Empresa</span>':''}</div>
      <div class="sc-meta">📱 ${esc(p.telefone||'—')} · <b>${esc(p.entrega||'Retirada')}</b> · <b>${fmtData(p.data)}${p.hora?' às '+esc(p.hora):''}</b></div>
      <div class="sc-itens">${esc(itensResumo)}${total?` · ${fmtBRL(total)}`:''}</div>
      ${p.obs?`<div class="card-meta" style="margin-top:2px;color:var(--accent)">📝 ${esc(p.obs)}</div>`:''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px">
        <span class="sc-badge ${cls}">${esc(status)}</span>
        ${ps?`<span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;background:${psEntregue?'#d1fae5':'#fef3c7'};color:${psEntregue?'#065f46':'#92400e'}">📦 ${esc(ps)}</span>`:''}
      </div>
    </div>
    <div class="sc-actions">
      ${buildStatusSelect(p.rowId,status)}
      <div class="sc-actions-row">
        <button class="btn-detalhes" onclick="abrirDetalhesPedido('${esc(p.rowId)}')">📋 Detalhes/Imprimir</button>
        <div class="card-menu-wrap">
          <button class="card-menu-btn" onclick="toggleCardMenu(this)" title="Mais ações">${ICON_MENU}</button>
          <div class="card-menu-dropdown">
            ${podeRestante?`<button class="btn-cobrar-restante" onclick="closeAllCardMenus();cobrarRestante('${esc(p.idPedido)}','${esc(p.telefone)}','${esc(p.cliente)}')">💳 Cobrar restante · ${fmtBRL(restante)}</button>`:''}
            ${podePagarRetirada?`<button class="btn-pagar-retirada" onclick="closeAllCardMenus();abrirConfirmPagarRetirada('${esc(p.rowId)}','${esc(p.cliente)}','${esc(p.telefone)}',this)">💵 Pagar na Retirada</button>`:''}
            <button class="btn-cobrar-total-adm" onclick="closeAllCardMenus();cobrarTotalAdmin('${esc(p.rowId)}')">💰 Cobrar Total</button>
            <button class="btn-cobrar-entrada-adm" onclick="closeAllCardMenus();cobrarEntradaAdmin('${esc(p.rowId)}')">💵 Cobrar Entrada</button>
            ${podeMarcarEntregue?`<button class="btn-marcar-entregue-adm" onclick="closeAllCardMenus();marcarEntregueAdmin('${esc(p.rowId)}')">🚚 Entregue</button>`:''}
            <button class="btn-editar-itens" onclick="closeAllCardMenus();abrirEditItens('${esc(p.rowId)}')">✏️ Editar itens</button>
            ${status!=='Finalizado'?`<button class="btn-finalizar" onclick="closeAllCardMenus();abrirConfirmFinalizar('${esc(p.rowId)}','${esc(p.cliente)}',this)">✅ Finalizar</button>`:''}
            <button class="btn-apagar" onclick="closeAllCardMenus();abrirConfirmApagar('${esc(p.rowId)}','${esc(p.cliente)}',this)">🗑️ Apagar</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// Fetch ÚNICO que alimenta TODAS as abas (Estoque pendente + status + Outros),
// com dedup por rowId e partição mutuamente exclusiva — o mesmo pedido nunca
// aparece em duas abas ao mesmo tempo.
async function carregarStatus(){
  try{
    const res=await fetch(`${WORKER}/pedidos-pendentes?todos=1`);
    const data=await res.json();
    // Dedup por rowId — mesmo que o worker devolva o pedido repetido, só entra 1x
    const vistos=new Set();
    const pedidos=(data.pedidos||[]).filter(p=>{
      const k=p.rowId||p.idPedido;
      if(vistos.has(k))return false;
      vistos.add(k);
      return true;
    });
    _pedidosCache=Object.fromEntries(pedidos.map(p=>[p.rowId,p]));

    // Auto-atualiza status baseado em "Pedido Status" da tabela Pedidos.
    // ⚠️ "Pedido Status" é multi-select no Coda → chega como ARRAY.
    for(const p of pedidos){
      const psArr=Array.isArray(p.pedidoStatus)?p.pedidoStatus:(p.pedidoStatus?[p.pedidoStatus]:[]);
      const chave=psArr.find(s=>PEDIDO_STATUS_MAP[s]);
      const novoStatus=chave?PEDIDO_STATUS_MAP[chave]:null;
      // "Finalizado" e "Cancelado" são estados FINAIS — nunca reescreve por cima
      // (era esse o motivo do status "voltar pro antigo" sozinho). E só escreve
      // valores que existem em STATUS_OPTS: string fora das Options do Coda
      // falharia silenciosamente lá e ficaria re-tentando a cada poll.
      if(novoStatus && STATUS_OPTS.includes(novoStatus) && p.status!==novoStatus
        && p.status!=='Finalizado' && p.status!=='Cancelado' && p.rowId){
        p.status=novoStatus; // atualiza localmente para renderizar certo
        fetch(`${WORKER}/atualizar-status`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({rowId:p.rowId,status:novoStatus})
        }).catch(()=>{});
      }
    }

    // Partição exclusiva: pré-confirmação → aba Estoque; resto → aba do status
    const estoque=[];
    const grupos={};
    pedidos.forEach(p=>{
      const status=p.status||'Aguardando confirmação';
      if(ESTOQUE_STATUS.includes(status)){estoque.push(p);return;}
      (grupos[status]=grupos[status]||[]).push(p);
    });

    // Aba Estoque só re-renderiza se a lista mudou (preserva edição inline em andamento)
    const sig=JSON.stringify(estoque.map(p=>[p.rowId,p.status,(p.itens||[]).length,p.total]));
    if(sig!==_estoqueSig){
      _estoqueSig=sig;
      renderPedidos(estoque);
    }

    // Renderiza cada status na sua própria aba
    STATUS_OPTS.forEach((status,idx)=>{
      renderStatusList(statusTabId(idx),grupos[status]||[],status,
        ESTOQUE_STATUS.includes(status)?'Pedidos nessa etapa ficam na aba "📦 Estoque pendente".':null);
    });

    // Qualquer status fora da lista padrão cai na aba "Outros" (só exibição —
    // o select mostra o status antigo desabilitado, nunca re-escreve ele no Coda)
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

function cobrarTotalAdmin(rowId){
  window.open(`${WORKER}/cobrar-total?rowId=${enc(rowId)}`,'_blank');
}

function cobrarEntradaAdmin(rowId){
  window.open(`${WORKER}/cobrar-entrada?rowId=${enc(rowId)}`,'_blank');
}

function marcarEntregueAdmin(rowId){
  window.open(`${WORKER}/marcar-entregue?rowId=${enc(rowId)}`,'_blank');
}

async function atualizarStatus(rowId,sel){
  const novoStatus=sel.value;
  // Trava de segurança: só escreve no Coda valores do ciclo canônico. Qualquer
  // outra string não existe como Option na coluna "Status" e falharia silenciosamente.
  if(!STATUS_OPTS.includes(novoStatus)){
    showToast('Esse status é antigo e não pode ser regravado — escolha um da lista.');
    carregarStatus();
    return;
  }
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
    // carregarPedidos() já recarrega tudo (Estoque + abas de status via carregarStatus)
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

// ── EDITAR ITENS (admin — disponível em QUALQUER status) ────────────────────
// Reusa o POST /editar-pedido do worker enviando origem:'admin': o worker então
// não restringe pela lista EDITAVEIS e NÃO rebaixa o Status do pedido (o gating
// por status continua valendo pro cliente via bot/Meus Pedidos).
// ⚠️ A subrow "🛵 Taxa de Entrega" NUNCA vai como item: aqui ela vira o campo
// taxaFrete (o worker tem o mesmo filtro do outro lado — sem isso a entrega
// entraria duplicada no pedido editado).
let _editRowId=null;
// Snapshot dos itens editáveis no momento da abertura — base do diff no salvar.
let _editSnap=[];
let _editSnapTaxa=0;
let _editSnapCliente='';

function abrirEditItens(rowId){
  const p=_pedidosCache[rowId];
  if(!p){showToast('Pedido ainda não carregou — tente de novo em instantes.');return;}
  _editRowId=rowId;
  const itens=p.itens||[];
  const taxaItem=itens.find(i=>String(i.produto||'').includes('Taxa de Entrega'));
  const editaveis=itens.filter(i=>!String(i.produto||'').includes('Taxa de Entrega'));
  // Guarda o estado ANTES da edição (nome/qtd/valor de cada item + taxa).
  _editSnap=editaveis.map(i=>({
    produto:String(i.produto||'').trim(),
    quantidade:Number(i.quantidade||1),
    valorUnit:Number(i.valorUnit||0),
  }));
  _editSnapTaxa=taxaItem?Number(taxaItem.valorItem||taxaItem.valorUnit||0):0;
  _editSnapCliente=p.cliente||'';
  document.getElementById('edit-sub').innerHTML=
    `<b>${esc(p.cliente||'—')}</b> · 📱 ${esc(p.telefone||'—')} · status atual: <b>${esc(p.status||'Aguardando confirmação')}</b>`;
  const tbody=document.getElementById('edit-itens-body');
  tbody.innerHTML='';
  editaveis.forEach((i,idx)=>tbody.appendChild(buildEditRow(i,idx)));
  if(!editaveis.length)addEditItem();
  document.getElementById('edit-frete').value=taxaItem?Number(taxaItem.valorItem||taxaItem.valorUnit||0).toFixed(2):'0.00';
  document.getElementById('edit-pago').textContent=(p.valorPago||0)>0?` · já pago: ${fmtBRL(p.valorPago)}`:'';
  recalcEdit();
  document.getElementById('edit-overlay').classList.add('open');
}

function buildEditRow(i,origIdx){
  const tr=document.createElement('tr');
  // Recheios/Topo Info da subrow original são preservados no dataset e reenviados
  // junto — a edição do admin troca produto/qtd/preço, não os detalhes do item.
  tr.dataset.recheios=(i&&i.recheios)||'';
  tr.dataset.topoinfo=(i&&i.topoInfo)||'';
  // origIdx casa a linha com o item do snapshot original (pra detectar A → B na
  // mesma linha vs item adicionado/removido). Linhas novas ficam sem o atributo.
  if(origIdx!=null)tr.dataset.origIdx=String(origIdx);
  tr.style.borderTop='1px solid var(--border)';
  tr.innerHTML=`
    <td style="padding:7px 0">
      ${buildProdutoSelect('edit',i?i.produto:'')}
      ${i&&i.recheios?`<div style="font-size:11px;color:var(--text3);margin-top:3px">${esc(i.recheios)}</div>`:''}
    </td>
    <td style="padding:7px 4px;text-align:center"><input class="inp-qty" type="number" value="${i?(i.quantidade||1):1}" min="0.1" step="0.1" oninput="recalcEdit()" style="${IS}width:52px;text-align:center"></td>
    <td style="padding:7px 4px;text-align:center"><input class="inp-unit" type="number" value="${i?Number(i.valorUnit||0).toFixed(2):'0.00'}" min="0" step="0.01" oninput="recalcEdit()" style="${IS}width:72px;text-align:center"></td>
    <td class="td-sub" style="padding:7px 0 7px 4px;text-align:right;font-size:13px;font-weight:600;white-space:nowrap">R$ 0,00</td>
    <td style="padding:7px 0 7px 8px"><button onclick="this.closest('tr').remove();recalcEdit()" style="background:none;border:none;cursor:pointer;color:#c0725a;font-size:18px;line-height:1;padding:0" title="Remover">×</button></td>`;
  return tr;
}

function addEditItem(){
  document.getElementById('edit-itens-body').appendChild(buildEditRow(null));
}

function recalcEdit(){
  let total=0;
  document.querySelectorAll('#edit-itens-body tr').forEach(tr=>{
    const qty=parseFloat(tr.querySelector('.inp-qty')?.value)||0;
    const unit=parseFloat(tr.querySelector('.inp-unit')?.value)||0;
    const sub=Math.round(qty*unit*100)/100;
    total+=sub;
    const td=tr.querySelector('.td-sub');
    if(td)td.textContent=fmtBRL(sub);
  });
  total+=parseFloat(document.getElementById('edit-frete')?.value)||0;
  const el=document.getElementById('edit-total');
  if(el)el.textContent=fmtBRL(Math.round(total*100)/100);
}

function closeEditModal(){
  document.getElementById('edit-overlay').classList.remove('open');
  _editRowId=null;
}

// Formata quantidade sem casas decimais desnecessárias (10 em vez de 10.0).
function _fmtQty(n){const v=Number(n)||0;return Number.isInteger(v)?String(v):String(v);}

// Monta o resumo legível das alterações comparando o snapshot original (_editSnap)
// com as linhas atuais. Cada linha nova carrega origIdx (índice no snapshot) quando
// veio de um item existente; sem origIdx = item adicionado. Índices do snapshot
// não consumidos = itens removidos.
function _montarResumoEdicao(cliente,linhas,taxaDepois){
  const partes=[];
  const usados=new Set();
  linhas.forEach(l=>{
    if(l.origIdx==null||!_editSnap[l.origIdx]){
      // Item adicionado
      partes.push(`+ ${l.nome} (x${_fmtQty(l.qty)})`);
      return;
    }
    usados.add(l.origIdx);
    const o=_editSnap[l.origIdx];
    const nomeMudou=o.produto!==l.nome;
    const qtdMudou=Number(o.quantidade)!==Number(l.qty);
    const valMudou=Math.round(Number(o.valorUnit)*100)!==Math.round(Number(l.unit)*100);
    if(nomeMudou){
      partes.push(`${o.produto} → ${l.nome}`);
      if(qtdMudou)partes.push(`${l.nome}: ${_fmtQty(o.quantidade)} → ${_fmtQty(l.qty)}`);
      if(valMudou)partes.push(`${l.nome}: ${fmtBRL(o.valorUnit)} → ${fmtBRL(l.unit)}`);
    }else{
      if(qtdMudou)partes.push(`${l.nome}: ${_fmtQty(o.quantidade)} → ${_fmtQty(l.qty)}`);
      if(valMudou)partes.push(`${l.nome}: ${fmtBRL(o.valorUnit)} → ${fmtBRL(l.unit)}`);
    }
  });
  // Itens removidos (no snapshot mas sem linha correspondente)
  _editSnap.forEach((o,idx)=>{
    if(!usados.has(idx))partes.push(`− ${o.produto} (x${_fmtQty(o.quantidade)})`);
  });
  // Mudança da taxa de entrega
  if(Math.round(Number(_editSnapTaxa)*100)!==Math.round(Number(taxaDepois)*100)){
    partes.push(`🛵 Taxa de entrega: ${fmtBRL(_editSnapTaxa)} → ${fmtBRL(taxaDepois)}`);
  }
  if(!partes.length)return '';
  return `Pedido de ${cliente||'—'}\n`+partes.join('\n');
}

async function salvarEditItens(){
  const p=_pedidosCache[_editRowId];
  if(!p){closeEditModal();return;}
  const itens=[];
  const linhas=[]; // paralelo a itens, com origIdx pra montar o diff
  document.querySelectorAll('#edit-itens-body tr').forEach(tr=>{
    const nome=(tr.querySelector('.inp-nome')?.value||'').trim();
    const qty=parseFloat(tr.querySelector('.inp-qty')?.value)||0;
    const unit=parseFloat(tr.querySelector('.inp-unit')?.value)||0;
    if(!nome||qty<=0)return;
    if(nome.includes('Taxa de Entrega'))return; // taxa nunca vai como item — vai em taxaFrete
    itens.push({nome,qty,unit,recheios:tr.dataset.recheios||'',topoInfo:tr.dataset.topoinfo||''});
    const origIdx=tr.dataset.origIdx!==undefined?parseInt(tr.dataset.origIdx,10):null;
    linhas.push({nome,qty,unit,origIdx});
  });
  if(!itens.length){showToast('O pedido precisa de pelo menos 1 item.');return;}
  const taxa=Math.max(0,parseFloat(document.getElementById('edit-frete').value)||0);
  const alteracoesResumo=_montarResumoEdicao(p.cliente||_editSnapCliente,linhas,taxa);
  const notificar=!!alteracoesResumo;
  const total=Math.round((itens.reduce((s,i)=>s+i.qty*i.unit,0)+taxa)*100)/100;
  // Contexto replicado nas subrows — mesmo padrão do fluxo de edição do cliente
  const ctx=[
    {column:'Cliente',value:p.cliente||''},
    {column:'WhatsApp',value:p.telefone||''},
    {column:'Entrega',value:p.entrega||''},
    {column:'Pagamento',value:p.pagamento||''},
    {column:'Data Desejada',value:p.data||''},
    {column:'Hora',value:p.hora||''},
  ];
  const subrows=itens.map(i=>[
    {column:'Produto',value:i.nome},
    {column:'Quantidade',value:i.qty},
    {column:'Valor Unit',value:i.unit},
    ...(i.recheios?[{column:'Recheios',value:i.recheios}]:[]),
    ...(i.topoInfo?[{column:'Topo Info',value:i.topoInfo}]:[]),
    ...ctx,
  ]);
  const btn=document.getElementById('edit-save-btn');
  btn.disabled=true;btn.textContent='Salvando...';
  try{
    const res=await fetch(`${WORKER}/editar-pedido`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({paiId:_editRowId,pai:[{column:'Total',value:total}],subrows,taxaFrete:taxa,origem:'admin',alteracoesResumo,notificar})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||d.ok===false)throw new Error(d.error||'Falha ao salvar edição no Coda');
    const novoTotal=(d.novoTotal!=null)?d.novoTotal:total;
    const aviso=notificar?' · cliente e Telegram avisados':' · nenhuma alteração a comunicar';
    showToast(`Itens atualizados ✅ Novo total: ${fmtBRL(novoTotal)}${(d.reembolso||0)>0?` · reembolso devido: ${fmtBRL(d.reembolso)}`:''}${aviso}`);
    closeEditModal();
    _estoqueSig=null; // itens mudaram — força re-render da aba Estoque também
    carregarStatus();
  }catch(e){
    showToast('Erro ao editar: '+e.message);
  }finally{
    btn.disabled=false;btn.textContent='Salvar alterações';
  }
}

// ── PEDIDO MANUAL — o atendente faz o pedido "como se fosse o cliente" ──
// Envia pro MESMO POST /novo-pedido do site (mesmo payload do checkout), então
// tudo se conecta sozinho: row no Pedidos Site, Telegram com "Confirmar Estoque",
// ciclo de status, cobrança/pagar-na-retirada, fila da cozinha, avisos no
// WhatsApp do cliente. Nada é gravado direto no Coda por aqui.
function abrirPedidoManual(){
  if(!_produtosList.length){showToast('Catálogo ainda carregando... tenta de novo em instantes');carregarPedidos();return;}
  document.getElementById('manual-itens-body').innerHTML='';
  addManualItem();
  const hoje=new Date();
  document.getElementById('man-data').value=hoje.toISOString().split('T')[0];
  document.getElementById('manual-overlay').classList.add('open');
  recalcManual();
}
function closeManualModal(){document.getElementById('manual-overlay').classList.remove('open');}

function buildManualRow(){
  const tr=document.createElement('tr');
  tr.innerHTML=`
    <td style="padding:7px 0">
      <input class="inp-nome" placeholder="Digite pra filtrar o produto..." autocomplete="off" oninput="manualProdutoInput(this)" onfocus="manualProdutoInput(this)" onblur="acFecharDepois(this)" style="${IS}width:100%">
      <div class="ac-lista" style="display:none"></div>
      <input class="inp-rech" placeholder="Recheios (opcional)" style="${IS}width:100%;margin-top:4px">
    </td>
    <td style="padding:7px 4px;text-align:center"><input class="inp-qty" type="number" value="1" min="0.1" step="0.1" oninput="recalcManual()" style="${IS}width:52px;text-align:center"></td>
    <td style="padding:7px 4px;text-align:center"><input class="inp-unit" type="number" value="0.00" min="0" step="0.01" oninput="recalcManual()" style="${IS}width:72px;text-align:center"></td>
    <td class="td-sub" style="padding:7px 0 7px 4px;text-align:right;font-size:13px;font-weight:600;white-space:nowrap">R$ 0,00</td>
    <td style="padding:7px 0 7px 8px"><button onclick="this.closest('tr').remove();recalcManual()" style="background:none;border:none;cursor:pointer;color:#c0725a;font-size:18px;line-height:1;padding:0" title="Remover">×</button></td>`;
  return tr;
}
function addManualItem(){document.getElementById('manual-itens-body').appendChild(buildManualRow());}

// Autocomplete do input de produto do pedido manual — dropdown PRÓPRIO (o
// <datalist> nativo não abre as sugestões em vários navegadores de celular).
// A lista aparece inline logo abaixo do campo (não é cortada pelo overflow do
// .itens-table-wrap e é boa de tocar). Digitar filtra sem acento/caixa; tocar
// numa sugestão preenche nome + preço. Produto fora do catálogo é permitido
// (preço manual) — só não preenche o preço.
function _acNorm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function manualProdutoInput(el){
  if(_produtosMap[el.value]!==undefined){
    const unitInput=el.closest('tr').querySelector('.inp-unit');
    if(unitInput)unitInput.value=(_produtosMap[el.value]||0).toFixed(2);
  }
  recalcManual();
  const box=el.closest('td')?.querySelector('.ac-lista');
  if(!box)return;
  const q=_acNorm(el.value);
  // Nome já escolhido (bate exato) e sem edição: não reabre a lista por cima
  if(_produtosMap[el.value]!==undefined&&document.activeElement!==el){box.style.display='none';return;}
  const matches=_produtosList.filter(n=>!q||_acNorm(n).includes(q)).slice(0,8);
  if(!matches.length||(matches.length===1&&matches[0]===el.value)){box.style.display='none';box.innerHTML='';return;}
  box.innerHTML=matches.map(n=>`<div class="ac-item" onmousedown="acEscolher(event,this)">${esc(n)}</div>`).join('');
  box.style.display='block';
}
// mousedown (dispara antes do blur do input) — funciona em desktop e touch
function acEscolher(ev,item){
  ev.preventDefault();
  const td=item.closest('td');
  const inp=td.querySelector('.inp-nome');
  inp.value=item.textContent;
  td.querySelector('.ac-lista').style.display='none';
  const unit=inp.closest('tr').querySelector('.inp-unit');
  if(unit&&_produtosMap[inp.value]!==undefined)unit.value=(_produtosMap[inp.value]||0).toFixed(2);
  recalcManual();
}
function acFecharDepois(el){
  setTimeout(()=>{
    const box=el.closest('td')?.querySelector('.ac-lista');
    if(box)box.style.display='none';
  },250);
}

function manualToggleEndereco(){
  const ehEntrega=document.getElementById('man-entrega').value==='Entrega em endereço';
  document.getElementById('man-end-wrap').style.display=ehEntrega?'':'none';
  document.getElementById('man-taxa-wrap').style.display=ehEntrega?'':'none';
  recalcManual();
}

// Coleta itens + valores do formulário (fonte única pra recalc e envio)
function _manualColeta(){
  const itens=[];
  document.querySelectorAll('#manual-itens-body tr').forEach(tr=>{
    const nome=(tr.querySelector('.inp-nome')?.value||'').trim();
    const qtd=parseFloat(tr.querySelector('.inp-qty')?.value)||0;
    const unit=parseFloat(tr.querySelector('.inp-unit')?.value)||0;
    const rech=(tr.querySelector('.inp-rech')?.value||'').trim();
    if(nome&&nome!=='__outro__'&&qtd>0)itens.push({nome,qtd,unit,rech});
  });
  const ehEntrega=document.getElementById('man-entrega').value==='Entrega em endereço';
  const taxa=ehEntrega?(parseFloat(document.getElementById('man-taxa').value)||0):0;
  const subtotal=itens.reduce((s,i)=>s+Math.round(i.qtd*i.unit*100)/100,0);
  const total=Math.round((subtotal+taxa)*100)/100;
  const pct=Math.min(100,Math.max(0,parseFloat(document.getElementById('man-entrada').value)||0))/100;
  const entrada=Math.round(total*pct*100)/100;
  return{itens,ehEntrega,taxa,total,entrada,restante:Math.round((total-entrada)*100)/100,pct};
}

function recalcManual(){
  document.querySelectorAll('#manual-itens-body tr').forEach(tr=>{
    const qtd=parseFloat(tr.querySelector('.inp-qty')?.value)||0;
    const unit=parseFloat(tr.querySelector('.inp-unit')?.value)||0;
    const td=tr.querySelector('.td-sub');
    if(td)td.textContent=fmtBRL(Math.round(qtd*unit*100)/100);
  });
  const c=_manualColeta();
  document.getElementById('man-total').textContent=fmtBRL(c.total);
  document.getElementById('man-resumo').textContent=` · Entrada ${Math.round(c.pct*100)}%: ${fmtBRL(c.entrada)} · Restante: ${fmtBRL(c.restante)}`;
}

async function enviarPedidoManual(){
  const nome=document.getElementById('man-nome').value.trim();
  const telRaw=document.getElementById('man-tel').value.trim();
  const telDigits=telRaw.replace(/\D/g,'');
  const data=document.getElementById('man-data').value;
  const hora=document.getElementById('man-hora').value||'';
  const c=_manualColeta();
  if(!nome){showToast('Falta o nome do cliente');return;}
  if(telDigits.length<10||telDigits.length>13){showToast('WhatsApp inválido — DDD + número');return;}
  if(!data){showToast('Falta a data de entrega');return;}
  if(!c.itens.length){showToast('Adicione pelo menos 1 item com produto e quantidade');return;}
  const entrega=document.getElementById('man-entrega').value;
  const endereco=c.ehEntrega?document.getElementById('man-end').value.trim():'';
  const pagamento=document.getElementById('man-pgto').value;
  const tipoCliente=document.getElementById('man-tipo').value;
  const obsBase=document.getElementById('man-obs').value.trim();
  const obs=obsBase?`${obsBase} [pedido manual — admin]`:'[pedido manual — admin]';

  // Payload idêntico ao do checkout do site (colunas exatas do Pedidos Site)
  const paiCells=[
    {column:'Cliente',value:nome},
    {column:'WhatsApp',value:telRaw},
    {column:'Total',value:c.total},
    {column:'Entrega',value:entrega},
    {column:'Endereço',value:endereco},
    {column:'Pagamento',value:pagamento},
    {column:'Data Desejada',value:data},
    {column:'Hora',value:hora},
    {column:'Observações',value:obs},
    {column:'Entrada',value:c.entrada},
    {column:'Restante',value:c.restante},
  ];
  if(tipoCliente)paiCells.push({column:'Tipo Cliente',value:tipoCliente});
  const subrows=c.itens.map(i=>[
    {column:'Produto',value:i.nome},
    {column:'Quantidade',value:i.qtd},
    {column:'Valor Unit',value:i.unit},
    {column:'Recheios',value:i.rech},
    {column:'Cliente',value:nome},
    {column:'WhatsApp',value:telRaw},
    {column:'Entrega',value:entrega},
    {column:'Pagamento',value:pagamento},
    {column:'Entrada',value:c.entrada},
    {column:'Restante',value:c.restante},
    {column:'Data Desejada',value:data},
    {column:'Hora',value:hora},
    {column:'Observações',value:obsBase},
  ]);

  const btn=document.getElementById('man-enviar');
  btn.disabled=true;btn.textContent='Criando...';
  try{
    const res=await fetch(`${WORKER}/novo-pedido`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pai:paiCells,subrows,taxaFrete:c.taxa})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok||!d||d.ok===false)throw new Error((d&&d.error)?d.error:'Falha ao registrar no Coda');
    showToast('Pedido criado! ✅ Telegram notificado — segue o fluxo normal.');
    closeManualModal();
    carregarStatus();
  }catch(e){
    showToast('Erro: '+e.message);
  }finally{
    btn.disabled=false;btn.textContent='Criar pedido';
  }
}

// ── BOOTSTRAP (no fim do arquivo: garante que todas as constantes já existem) ──
carregarPedidos();
setInterval(carregarStatus,30000);

