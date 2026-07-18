
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
function isPacote(tipo){return tipo&&tipo.toLowerCase().includes('pacote');}

// ── Phone mask & validation ──
function maskPhone(input){
  let v=input.value.replace(/\D/g,'');
  if((v.length===12||v.length===13)&&v.startsWith('55'))v=v.slice(2);
  if(v.length>11)v=v.slice(0,11);
  if(v.length<=10){
    v=v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3');
  } else {
    v=v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3');
  }
  input.value=v.replace(/-$/,'');
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
// ── CEP ──
function formatCep(v){return v.replace(/\D/g,'').replace(/^(\d{5})(\d)/,'$1-$2').slice(0,9);}


// ── LANDING PAGE ──
function verCardapio() {
  document.getElementById('ticker-section').style.display = 'none';
  // Esconde botão do hero (hero-content)
  const heroBtn = document.querySelector('.hero-btn');
  if (heroBtn) heroBtn.style.display = 'none';
  // Mostra elementos do catálogo
  ['search-section','mv-section','cats-row','page-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('landing-hidden');
  });
  // Rola suavemente para o catálogo
  setTimeout(() => {
    const cat = document.getElementById('cats-row') || document.getElementById('mv-section');
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

