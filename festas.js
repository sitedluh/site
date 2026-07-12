/* ============================================================
   festas.js — lógica enxuta da página de orçamento de festas.
   Sem dependências: define CONFIG + helpers próprios (não
   carrega festas-core.js pra manter a página leve, MVP Fase 1).
   Fonte de verdade do plano: FESTAS-PLANO.md
   ============================================================ */

const CONFIG = {
  WORKER_URL: 'https://coda-proxy.sitedluh.workers.dev',
  WHATSAPP: '5538992229178'
};

/* ── Helpers (copiados/adaptados de cardapio-core.js) ── */
function showToast(msg){
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2600);
}
function maskPhone(input){
  let v=input.value.replace(/\D/g,'');
  if(v.length>11)v=v.slice(0,11);
  if(v.length<=10){ v=v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3'); }
  else{ v=v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3'); }
  input.value=v.replace(/-$/,'');
}
function fmtDataBR(iso){ return iso ? iso.split('-').reverse().join('/') : ''; }

/* ── Data mínima = hoje ── */
(function(){
  const d=document.getElementById('f-data');
  if(!d)return;
  const now=new Date(),pad=n=>String(n).padStart(2,'0');
  const hoje=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  d.min=hoje;
})();

/* ── Checkboxes de serviços (visual toggle) ── */
function toggleServico(el){
  const chk=el.querySelector('input');
  el.classList.toggle('on', chk.checked);
}

/* ── CEP → preenche local (ViaCEP, sem frete) ── */
async function onCepFesta(el){
  el.value=el.value.replace(/\D/g,'').replace(/^(\d{5})(\d)/,'$1-$2').slice(0,9);
  const cep=el.value.replace(/\D/g,'');
  if(cep.length!==8)return;
  try{
    const res=await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data=await res.json();
    if(data.erro)return;
    const local=document.getElementById('f-local');
    const montado=[data.logradouro,data.bairro,data.localidade,data.uf].filter(Boolean).join(', ');
    if(local && !local.value.trim() && montado) local.value=montado;
  }catch(_){}
}

/* ── Coleta + valida os campos ── */
function _coletar(){
  const g=id=>{const el=document.getElementById(id);return el?el.value.trim():'';};
  const servicos=[...document.querySelectorAll('.f-chk input:checked')].map(i=>i.value);
  return {
    nome:g('f-nome'), tel:g('f-tel'), tipoEvento:g('f-tipo-evento'),
    numConvidados:g('f-convidados'), local:g('f-local'), data:g('f-data'),
    hora:g('f-hora'), servicos, obs:g('f-obs')
  };
}
function _validar(d){
  let ok=true, first=null;
  const mark=(rowId,bad)=>{
    const row=document.getElementById(rowId);
    if(!row)return;
    row.classList.toggle('error',bad);
    if(bad&&!first)first=row;
    if(bad)ok=false;
  };
  mark('row-nome',!d.nome);
  mark('row-tel',!(d.tel.replace(/\D/g,'').length>=10));
  mark('row-tipo-evento',!d.tipoEvento);
  mark('row-data',!d.data);
  if(first){
    first.scrollIntoView({behavior:'smooth',block:'center'});
    const f=first.querySelector('input,select,textarea'); if(f)f.focus({preventScroll:true});
  }
  return ok;
}

/* ── Monta a mensagem pronta pro WhatsApp (fallback e resumo) ── */
function _montarMsg(d){
  let msg=`🎉 *ORÇAMENTO DE FESTA — D'Luh Festas*\n\n`;
  msg+=`👤 *Cliente:* ${d.nome}\n📱 *WhatsApp:* ${d.tel}\n`;
  msg+=`🎈 *Tipo de evento:* ${d.tipoEvento}\n`;
  if(d.numConvidados)msg+=`👥 *Convidados:* ${d.numConvidados}\n`;
  if(d.data)msg+=`📅 *Data:* ${fmtDataBR(d.data)}${d.hora?' às '+d.hora:''}\n`;
  if(d.local)msg+=`📍 *Local:* ${d.local}\n`;
  if(d.servicos.length)msg+=`\n🧾 *Serviços desejados:*\n${d.servicos.map(s=>'  • '+s).join('\n')}\n`;
  if(d.obs)msg+=`\n📝 *Observações:* ${d.obs}`;
  return msg;
}

/* ── Monta payload do Coda (mesma forma do /novo-pedido do cardápio) ── */
function _montarPayload(d){
  // Row pai na tabela Orçamentos. Colunas EXTRAS de festa exigem existir no Coda
  // (senão a escrita falha SILENCIOSAMENTE): 'Tipo Cliente' com Option 'Festa',
  // 'Tipo Evento', 'Nº Convidados', 'Local Evento'.
  const paiCells=[
    {column:'Cliente',        value:d.nome},
    {column:'WhatsApp',       value:d.tel},
    {column:'Tipo Cliente',   value:'Festa'},
    {column:'Tipo Evento',    value:d.tipoEvento},
    {column:'Nº Convidados',  value:d.numConvidados?Number(d.numConvidados)||d.numConvidados:''},
    {column:'Local Evento',   value:d.local},
    {column:'Endereço',       value:d.local},
    {column:'Data Desejada',  value:d.data},
    {column:'Hora',           value:d.hora},
    {column:'Observações',    value:d.obs},
    {column:'Total',          value:0},   // a orçar pelo atendente
    {column:'Entrada',        value:0},
    {column:'Restante',       value:0}
  ];
  // Serviços desejados viram subrows (itens filhos), valor 0 até o atendente orçar.
  const subrows=d.servicos.map(s=>([
    {column:'Produto',     value:s},
    {column:'Quantidade',  value:1},
    {column:'Valor Unit',  value:0},
    {column:'Cliente',     value:d.nome},
    {column:'WhatsApp',    value:d.tel},
    {column:'Data Desejada',value:d.data},
    {column:'Observações', value:d.obs}
  ]));
  return {pai:paiCells, subrows, tipoCliente:'Festa', taxaFrete:0};
}

/* ── Envio ── */
let _enviando=false;
async function enviarOrcamento(){
  if(_enviando)return;
  const d=_coletar();
  if(!_validar(d))return;

  const btn=document.getElementById('f-submit-btn');
  const orig=btn?btn.innerHTML:'';
  if(btn){btn.disabled=true;btn.innerHTML='⏳ Enviando orçamento...';}
  _enviando=true;

  const msg=_montarMsg(d);
  const waUrl=`https://wa.me/${CONFIG.WHATSAPP}?text=${encodeURIComponent(msg)}`;

  try{
    const ctrl=new AbortController();
    const to=setTimeout(()=>ctrl.abort(),15000);
    let res,json;
    try{
      res=await fetch(`${CONFIG.WORKER_URL}/novo-pedido`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(_montarPayload(d)),
        signal:ctrl.signal
      });
    }finally{ clearTimeout(to); }
    json=await res.json().catch(()=>({}));
    if(!res.ok||(json&&json.ok===false)) throw new Error((json&&json.error)||'Falha ao registrar');

    // Sucesso: leva o cliente pro WhatsApp da loja com o resumo já montado,
    // pra combinar valores com o atendente (o orçamento já está no Coda + Telegram).
    showToast('Orçamento enviado! Abrindo o WhatsApp para combinar os detalhes 🎉');
    setTimeout(()=>_abrirWhats(waUrl),900);
  }catch(e){
    // Fallback: mesmo padrão do cardápio — se a integração falhar, abre o WhatsApp
    // com a mensagem pronta pra não perder o lead.
    console.warn('Falha ao registrar orçamento de festa:',e);
    showToast('Não conseguimos registrar automático — abrindo o WhatsApp para você enviar 💬');
    setTimeout(()=>_abrirWhats(waUrl),900);
  }finally{
    _enviando=false;
    if(btn){btn.disabled=false;btn.innerHTML=orig;}
  }
}
function _abrirWhats(url){
  let opened=false;
  try{const w=window.open(url,'_blank');opened=!!(w&&!w.closed);}catch(_){}
  if(!opened)window.location.href=url;
}
