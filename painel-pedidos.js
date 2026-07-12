
// ── CONFIG ──────────────────────────────────────────────
const CFG = {
  token: 'c2df9327-a40c-4716-9f59-c40620d691ef',
  docId: 'Wq8ktEEI3N',
  tableId: 'Pedidos Base',
  cols: {
    nome: 'c-qNsNbVHKNI',
    data: 'c-0y6_X-_T7g',
    hora: 'c-bL3KECWBkd',
    tipo: 'c-NWtelSDmAE',
    pedido: 'c-txX8tge0sr',
    telefone: 'c-WhdvD5qzPB',
    valor: 'c-lTihbeP5Cj',
    status: 'c-SpdhR0ZMGd',
    // O worker (/pedido-feito) grava Status="Feito" na Pedidos Base — é a fonte da
    // escrita. O painel NÃO escreve mais no Status; só usa este valor para reconhecer
    // (na leitura/poll) quais pedidos já saíram como "Feito" e marcá-los como concluídos.
    statusValor: 'Feito',
    // Valores de Status que significam pedido CONCLUÍDO (não é mais fila, não pode
    // ficar "atrasado"). Cobre o desfecho novo ("Feito") e os antigos ("Entregue",
    // "Retirado", "Finalizado") — a coluna Status pode ter qualquer um dependendo
    // do fluxo em que o pedido foi fechado. Comparação case-insensitive e tolerante
    // a array (a coluna pode chegar como multi-select).
    statusFinais: ['Feito', 'Entregue', 'Retirado', 'Finalizado']
  },
  alertHours: 1
};

// ── STATE ───────────────────────────────────────────────
let orders = [];
let allOrders = []; // todos os pedidos sem filtro de data
let filter = 'todos';
let soundOn = true;
let alerted = new Set();
let audioCtx = null;
let audioUnlocked = false;
let selectedDate = 'hoje'; // 'hoje', 'todos', 'YYYY-MM-DD'

// ── CLOCK ───────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('date-txt').textContent =
    now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}
setInterval(tickClock, 1000);
tickClock();

// ── AUDIO ───────────────────────────────────────────────
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function unlockAudio() {
  getCtx();
  audioUnlocked = true;
  document.getElementById('unlock-btn').style.display = 'none';
  playBell(1).then(() => speak('Som ativado!'));
}

async function playBell(intensity) {
  const ctx = getCtx();
  const ring = (delay, freq, gain) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o2.type = 'sine'; o2.frequency.value = freq * 2.76;
    g.gain.setValueAtTime(0, ctx.currentTime + delay);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 2.5);
    g2.gain.setValueAtTime(0, ctx.currentTime + delay);
    g2.gain.linearRampToValueAtTime(gain * 0.3, ctx.currentTime + delay + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 1.5);
    o.connect(g); g.connect(ctx.destination);
    o2.connect(g2); g2.connect(ctx.destination);
    o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 2.5);
    o2.start(ctx.currentTime + delay); o2.stop(ctx.currentTime + delay + 1.5);
  };
  const rings = intensity >= 3 ? 4 : intensity === 2 ? 3 : 2;
  const freq = intensity >= 3 ? 880 : intensity === 2 ? 740 : 660;
  for (let i = 0; i < rings; i++) ring(i * 0.55, freq, 0.6);
  return new Promise(r => setTimeout(r, rings * 550 + 500));
}

let speakQueue = Promise.resolve();

function speak(text) {
  if (!soundOn) return;
  speakQueue = speakQueue.then(() => new Promise(resolve => {
    try {
      if (!window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 0.88;
      u.volume = 1;
      u.onend = resolve;
      u.onerror = resolve;
      setTimeout(resolve, 8000); // watchdog

      const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        const pt = voices.find(v => v.lang === 'pt-BR')
                || voices.find(v => v.lang.startsWith('pt'))
                || voices[0];
        if (pt) u.voice = pt;
        window.speechSynthesis.speak(u);
      };

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) trySpeak();
      else { window.speechSynthesis.onvoiceschanged = () => trySpeak(); }
    } catch(e) { resolve(); }
  }));
}

function testarVoz() {
  playBell(1).then(() => speak('Teste de voz. Painel de pedidos funcionando!'));
}

function toggleSound() {
  soundOn = !soundOn;
  document.getElementById('sdot').className = 'sdot' + (soundOn ? '' : ' off');
  document.getElementById('slabel').textContent = soundOn ? 'Som' : 'Mudo';
  if (soundOn) playBell(1).then(() => speak('Som ativado!'));
}

// ── TOAST ───────────────────────────────────────────────
let toastTimer = null;
function showToast(title, sub) {
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-sub').textContent = sub || '';
  document.getElementById('toast').classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() { document.getElementById('toast').classList.remove('show'); }

// ── ALERTS ──────────────────────────────────────────────
const STAGES = [60, 30, 15, 5, 0];

async function alertNewOrder(order) {
  const isEntrega = order.tipo.toLowerCase().includes('entrega');
  const tipo = isEntrega ? 'entrega' : 'retirada';

  showToast(
    `🆕 Novo pedido — ${fmtDate(order.datetime)} ${fmtTime(order.datetime)}`,
    `${order.nome} · ${isEntrega ? '🛵 Entrega' : '🛍️ Retirada'}`
  );

  if (soundOn) {
    await playBell(2);
    speak(`Novo pedido recebido! ${order.nome}, ${tipo} para ${fmtTimeSpeak(order.datetime)}.`);
  }
}

function fmtTimeSpeak(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    .replace(':', ' horas e ') + ' minutos';
}

async function triggerAlert(order, mins, type) {
  const isEntrega = order.tipo.toLowerCase().includes('entrega');
  const tipo = isEntrega ? 'entrega' : 'retirada';
  let bell, title, speech;

  if (type === 'late') {
    bell = 3; title = `⚠️ ATRASADO ${mins}min — ${order.nome}`;
    speech = `Atenção! O pedido de ${order.nome} está atrasado ${mins} minutos.`;
  } else if (mins === 0) {
    bell = 3; title = `🔔 AGORA — ${order.nome}`;
    speech = `Hora do pedido! ${order.nome}, ${tipo} agora!`;
  } else if (mins <= 5) {
    bell = 3; title = `🔥 ${mins} min — ${order.nome}`;
    speech = `Urgente! ${mins} minutos para o pedido de ${order.nome}.`;
  } else if (mins <= 15) {
    bell = 2; title = `⏰ ${mins} min — ${order.nome}`;
    speech = `Atenção! ${mins} minutos para o pedido de ${order.nome} para ${tipo}.`;
  } else {
    bell = 1; title = `🔔 ${mins} min — ${order.nome}`;
    speech = `Lembrete. ${mins} minutos para o pedido de ${order.nome} para ${tipo}.`;
  }

  showToast(title, fmtTime(order.datetime) + ' · ' + (isEntrega ? '🛵 Entrega' : '🛍️ Retirada'));
  if (soundOn) { await playBell(bell); speak(speech); }
  renderAll();
}

function checkAlerts() {
  const now = new Date();
  orders.forEach(o => {
    if (o.entregue) return;
    const diffMin = Math.round((o.datetime - now) / 60000);
    STAGES.forEach(s => {
      const key = `${o.id}_s${s}`;
      if (diffMin <= s && diffMin > s - 1.5 && !alerted.has(key)) {
        alerted.add(key); triggerAlert(o, s, 'pre');
      }
    });
    if (diffMin < 0) {
      const lk = `${o.id}_late${Math.floor(Math.abs(diffMin) / 5)}`;
      if (!alerted.has(lk)) { alerted.add(lk); triggerAlert(o, Math.abs(diffMin), 'late'); }
    }
  });
}
setInterval(checkAlerts, 30000);

// ── CODA ────────────────────────────────────────────────
async function fetchOrders() {
  document.getElementById('rlabel').textContent = '⟳ Atualizando...';
  try {
    let allItems = [];
    let pageToken = null;

    do {
      const url = `https://coda.io/apis/v1/docs/${CFG.docId}/tables/${encodeURIComponent(CFG.tableId)}/rows?limit=500${pageToken ? '&pageToken=' + pageToken : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${CFG.token}` } });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        document.getElementById('rlabel').textContent = `❌ ${e.message || res.status}`;
        return;
      }
      const data = await res.json();
      allItems = allItems.concat(data.items || []);
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    // Busca o valor a cobrar e o valor já pago pelo NOME da coluna ("Valor Total" / "Valor Pago"),
    // não pelo ID. O ID c-lTihbeP5Cj usado acima pode apontar para outra coluna (ex.: valor unitário/parcial),
    // então buscamos os mesmos registros com useColumnNames=true para pegar os valores certos.
    const valorTotalMap = {};
    const valorPagoMap = {};
    const valorEntregaMap = {};
    const pagoStatusMap = {};
    try {
      let vItems = [];
      let vToken = null;
      do {
        const vUrl = `https://coda.io/apis/v1/docs/${CFG.docId}/tables/${encodeURIComponent(CFG.tableId)}/rows?limit=500&valueFormat=simpleWithArrays&useColumnNames=true${vToken ? '&pageToken=' + vToken : ''}`;
        const vRes = await fetch(vUrl, { headers: { Authorization: `Bearer ${CFG.token}` } });
        if (!vRes.ok) break;
        const vData = await vRes.json();
        vItems = vItems.concat(vData.items || []);
        vToken = vData.nextPageToken || null;
      } while (vToken);
      vItems.forEach(row => {
        const vv = row.values || {};
        valorTotalMap[row.id] = vv['Valor Total'];
        valorPagoMap[row.id] = (vv['Valor Pago'] !== undefined ? vv['Valor Pago'] : vv['Valor pago']);
        // "Valor da Entrega" (campo do pai) e "Pago?" (Não pago / Só entrada / Totalmente pago)
        valorEntregaMap[row.id] = vv['Valor da Entrega'];
        pagoStatusMap[row.id] = vv['Pago?'] || '';
      });
    } catch(e) { /* se falhar, parseRows cai no fallback pelo ID antigo / sem valor pago */ }

    const newAllOrders = parseRows(allItems, valorTotalMap, valorPagoMap, valorEntregaMap, pagoStatusMap);

    // Detecta pedidos novos (que não existiam antes)
    if (allOrders.length > 0) {
      const existingIds = new Set(allOrders.map(o => o.id));
      const novos = newAllOrders.filter(o => !existingIds.has(o.id));
      novos.forEach(o => alertNewOrder(o));
    }

    allOrders = newAllOrders;
    applyDateFilter();
    checkAlerts();
    document.getElementById('rlabel').textContent =
      '✓ Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch(e) {
    document.getElementById('rlabel').textContent = '❌ Sem conexão';
  }
}

function parseRows(rows, valorTotalMap, valorPagoMap, valorEntregaMap, pagoStatusMap) {
  const c = CFG.cols;
  valorTotalMap = valorTotalMap || {};
  valorPagoMap = valorPagoMap || {};
  valorEntregaMap = valorEntregaMap || {};
  pagoStatusMap = pagoStatusMap || {};
  return rows
    .filter(row => !row.parent) // ignora linhas filho (subpáginas)
    .map((row, i) => {
    const v = row.values || {};
    let dt = null;

    try {
      const rawData = v[c.data];
      const rawHora = v[c.hora];

      if (rawData) {
        const s = String(rawData).trim();
        let dateOnly = null;

        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
          dateOnly = new Date(s.split('T')[0] + 'T00:00:00');
        } else if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
          const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (m) dateOnly = new Date(+m[3], +m[2]-1, +m[1]);
        } else {
          dateOnly = new Date(s);
        }

        if (dateOnly && !isNaN(dateOnly)) {
          if (rawHora) {
            const hm = String(rawHora).trim().match(/(\d{1,2}):(\d{2})/);
            if (hm) dateOnly.setHours(+hm[1], +hm[2], 0, 0);
          }
          dt = dateOnly;
        }
      }
    } catch(e) { /* ignora silenciosamente */ }

    // Sem data válida — pula sem travar
    if (!dt || isNaN(dt)) return null;

    return {
      id: row.id, // sempre usa o ID único do Coda
      nome: v[c.nome] || '(sem nome)',
      telefone: v[c.telefone] || '',
      tipo: v[c.tipo] || 'Retirada',
      datetime: dt,
      pedido: v[c.pedido] || '',
      // "Valor Total" (pelo nome da coluna) é a fonte correta para cobrança.
      // Fallback para o valor antigo (por ID) só se a busca por nome não retornar nada.
      valor: (valorTotalMap[row.id] !== undefined && valorTotalMap[row.id] !== null && valorTotalMap[row.id] !== '')
        ? valorTotalMap[row.id]
        : (v[c.valor] || ''),
      // "Valor Pago" pelo nome da coluna — usado para calcular o que falta cobrar na entrega.
      valorPago: (valorPagoMap[row.id] !== undefined && valorPagoMap[row.id] !== null) ? valorPagoMap[row.id] : 0,
      valorEntrega: valorEntregaMap[row.id] || '',
      pago: pagoStatusMap[row.id] || '',
      entregue: pedidoConcluido(v[c.status], c.statusFinais)
    };
  }).filter(Boolean).sort((a,b) => a.datetime - b.datetime);
}

// Um pedido está CONCLUÍDO quando o Status da Pedidos Base bate com qualquer valor
// da lista de finais (CFG.cols.statusFinais). Trata a coluna Status como string OU
// array (multi-select) e compara case-insensitive, com trim. Concluído => nunca é
// tratado como fila/atrasado (o resto do painel deriva tudo de `entregue`).
function pedidoConcluido(statusVal, finais) {
  const finaisLc = (finais || []).map(s => String(s).trim().toLowerCase());
  const arr = Array.isArray(statusVal) ? statusVal : [statusVal];
  return arr.some(s => finaisLc.includes(String(s || '').trim().toLowerCase()));
}

// Calcula o restante a cobrar de um pedido (total - valor pago), nunca negativo.
function calcRestante(o) {
  const totalNum = parseFloat(String(o.valor || '0').replace(/[^\d,.]/g,'').replace(',','.')) || 0;
  const pagoNum = parseFloat(String(o.valorPago || '0').replace(/[^\d,.]/g,'').replace(',','.')) || 0;
  const restanteNum = Math.max(Math.round((totalNum - pagoNum) * 100) / 100, 0);
  return { totalNum, pagoNum, restanteNum };
}

function fmtMoneyBR(n) {
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

// Pedido pendente de confirmação (aguardando resposta da caixa de diálogo).
let _entregaPendingId = null;

// Chamado pelos botões "Feito". Nenhuma alteração (Coda, worker, WhatsApp) é feita
// aqui — só abre a caixa de confirmação. Só depois que o usuário confirmar
// (entregaConfirmSim) é que marcarFeito roda de fato.
function confirmarEntrega(id) {
  // Procura em orders e também em allOrders (fallback de segurança — orders é o
  // subconjunto filtrado pela data selecionada, então se algo ficar fora do filtro
  // ainda achamos o pedido aqui em vez de simplesmente não fazer nada).
  const o = (orders.find(x => x.id === id)) || (allOrders.find(x => x.id === id));
  if (!o) { console.error('confirmarEntrega: pedido não encontrado', id); return; }
  _entregaPendingId = id;
  document.getElementById('entrega-confirm-nome').textContent = o.nome;
  document.getElementById('entrega-confirm-overlay').classList.add('open');
}

function closeEntregaConfirm() {
  document.getElementById('entrega-confirm-overlay').classList.remove('open');
  _entregaPendingId = null;
}

// Confirmação única — o usuário disse "Sim, marcar como Feito".
function entregaConfirmSim() {
  const id = _entregaPendingId;
  document.getElementById('entrega-confirm-overlay').classList.remove('open');
  _entregaPendingId = null;
  if (!id) return;
  marcarFeito(id);
}

// Marca o pedido como "Feito" chamando o worker. O worker é a fonte de verdade:
// grava Status="Feito" na Pedidos Base, gera/recupera o link InfinitePay e ENVIA a
// mensagem de cobrança ao cliente no WhatsApp. O painel NÃO cobra nem escreve Status
// no Coda — só dispara a rota e reflete o resultado na UI local.
async function marcarFeito(id) {
  const btn = document.getElementById('db-' + id);
  const originalText = btn ? btn.textContent : '✔️ Feito';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
  const o = (orders.find(x => x.id === id)) || (allOrders.find(x => x.id === id));
  try {
    // valor = restante a cobrar já calculado pelo painel; o worker tem fallback
    // ("Valor Total") caso venha vazio/ausente.
    const restanteNum = o ? calcRestante(o).restanteNum : undefined;
    const res = await fetch('https://coda-proxy.sitedluh.workers.dev/pedido-feito', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rowId: id,
        telefone: o ? o.telefone : undefined,
        cliente: o ? o.nome : undefined,
        valor: restanteNum,
      })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) {
      showToast('❌ Erro ao marcar Feito', d.error || ('HTTP ' + res.status));
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }
    // Sucesso: worker já gravou "Feito" no Coda. Reflete localmente para a UI atualizar
    // na hora (sem reescrever o Status no Coda). O próximo poll relê "Feito" e mantém.
    if (o) o.entregue = true;
    showToast('✅ Pedido Feito!', (d.cliente || (o ? o.nome : '')) + ' — cobrança enviada no WhatsApp');
    speak('Pedido marcado como feito!');
    renderAll();
  } catch(e) {
    showToast('❌ Erro de conexão', e.message);
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

// ── RENDER ──────────────────────────────────────────────
// ── DATE PICKER ─────────────────────────────────────────
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

function toggleDatePicker() {
  const dp = document.getElementById('date-picker');
  const isOpen = dp.style.display !== 'none';
  dp.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderCal();
}

// Close when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('date-picker-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('date-picker').style.display = 'none';
  }
});

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCal();
}

function renderCal() {
  const dias = ['D','S','T','Q','Q','S','S'];
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  document.getElementById('cal-title').textContent = `${meses[calMonth]} ${calYear}`;

  const today = new Date(); today.setHours(0,0,0,0);
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();

  // Dates that have orders
  const orderDates = new Set(allOrders.map(o => {
    const d = new Date(o.datetime);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }));

  let html = dias.map(d => `<div class="cal-header">${d}</div>`).join('');

  // Prev month days
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calYear, calMonth, d);
    const dateKey = `${calYear}-${calMonth}-${d}`;
    const isToday = date.getTime() === today.getTime();
    const hasOrders = orderDates.has(dateKey);
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSelected = selectedDate === dateStr;

    let cls = 'cal-day';
    if (isToday) cls += ' today';
    if (hasOrders) cls += ' has-orders';
    if (isSelected) cls += ' selected';

    html += `<div class="${cls}" onclick="selectCalDate('${dateStr}')">${d}</div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;

  // Highlight active quick option
  document.querySelectorAll('.dq-opt').forEach(el => el.classList.remove('active'));
  const quickMap = { hoje:'Hoje', amanha:'Amanhã', semana:'Próximos 7 dias', mes:'Este mês', todos:'Todos os pedidos', passados:'Pedidos passados' };
  document.querySelectorAll('.dq-opt').forEach(el => {
    if (Object.values(quickMap).some(v => el.textContent.includes(v.split(' ')[1] || v))) {
      // skip complex match
    }
  });
}

function selectCalDate(dateStr) {
  selectedDate = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('date-filter-label').textContent =
    d.toLocaleDateString('pt-BR', {weekday:'short', day:'2-digit', month:'2-digit'});
  document.getElementById('date-picker').style.display = 'none';
  applyDateFilter();
}

function applyDateFilter() {
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
  const in7 = new Date(today); in7.setDate(in7.getDate()+7);
  const endMonth = new Date(today.getFullYear(), today.getMonth()+1, 0);

  if (selectedDate === 'hoje') {
    orders = allOrders.filter(o => { const d=new Date(o.datetime); d.setHours(0,0,0,0); return d.getTime()===today.getTime(); });
  } else if (selectedDate === 'amanha') {
    orders = allOrders.filter(o => { const d=new Date(o.datetime); d.setHours(0,0,0,0); return d.getTime()===tomorrow.getTime(); });
  } else if (selectedDate === 'semana') {
    orders = allOrders.filter(o => { const d=new Date(o.datetime); return d>=today && d<=in7; });
  } else if (selectedDate === 'mes') {
    orders = allOrders.filter(o => { const d=new Date(o.datetime); return d>=today && d<=endMonth; });
  } else if (selectedDate === 'todos') {
    orders = [...allOrders];
  } else if (selectedDate === 'passados') {
    orders = allOrders.filter(o => new Date(o.datetime) < today).reverse();
  } else {
    const sel = new Date(selectedDate + 'T00:00:00');
    orders = allOrders.filter(o => { const d=new Date(o.datetime); d.setHours(0,0,0,0); return d.getTime()===sel.getTime(); });
  }
  renderAll();
}

function setDateFilter(val) {
  selectedDate = val;
  const labels = { hoje:'Hoje', amanha:'Amanhã', semana:'Próx. 7 dias', mes:'Este mês', todos:'Todos', passados:'Passados' };
  document.getElementById('date-filter-label').textContent = labels[val] || val;
  document.getElementById('date-picker').style.display = 'none';
  applyDateFilter();
}

function setFilter(f, btn) {
  filter = f;
  document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

// ── Destaque "Fazer agora" ──
// Até 2 pedidos no destaque central: atrasados + os que vencem na próxima 1h
// (fallback: o próximo da fila). Com 2, alternam sozinhos a cada 10s, com setas
// e indicador pra trocar manualmente (featNav).
let _featList = [];
let _featIdx = 0;

function featNav(dir) {
  if (_featList.length < 2) return;
  _featIdx = (_featIdx + dir + _featList.length) % _featList.length;
  _featRotDelay = 3; // segura a rotação automática por ~30s depois de um toque manual
  renderAll();
}
let _featRotDelay = 0;
setInterval(() => {
  if (_featList.length > 1) {
    if (_featRotDelay > 0) { _featRotDelay--; return; }
    _featIdx = (_featIdx + 1) % _featList.length;
    renderAll();
  }
}, 10000);

function renderAll() {
  const now = new Date();
  const pend = orders.filter(o => !o.entregue);
  const atrasados = pend.filter(o => o.datetime < now).sort((a,b) => a.datetime - b.datetime);
  const proximos = pend.filter(o => o.datetime >= now).sort((a,b) => a.datetime - b.datetime);
  let agora = atrasados.concat(proximos.filter(o => (o.datetime - now) / 60000 <= 60));
  if (!agora.length) agora = proximos.slice(0, 1); // nada urgente: mostra o próximo da fila
  _featList = agora.slice(0, 2);
  if (_featIdx >= _featList.length) _featIdx = 0;
  const featured = _featList[_featIdx] || null;
  renderFeatured(featured, now);
  const filtered = orders.filter(o => {
    if (filter === 'retirada') return o.tipo.toLowerCase().includes('retirada');
    if (filter === 'entrega') return o.tipo.toLowerCase().includes('entrega');
    if (filter === 'urgente') { const m = (o.datetime - now) / 60000; return m >= 0 && m <= 60; }
    return true;
  });
  // Entregues vão para o fim
  filtered.sort((a, b) => {
    if (a.entregue && !b.entregue) return 1;
    if (!a.entregue && b.entregue) return -1;
    return a.datetime - b.datetime;
  });
  // Fila embaixo = tudo que não está no destaque (os 2 do "fazer agora" saem da lista)
  renderQueue(filtered.filter(o => !_featList.some(f => f.id === o.id)), featured, now);
  renderMobile(); // atualiza versão mobile também
}

// Badge da coluna "Pago?" da Pedidos Base (Não pago / Só entrada / Totalmente pago)
function pagoBadge(o) {
  const p = String(o.pago || '').toLowerCase();
  if (!p) return '';
  if (p.includes('não') || p.includes('nao')) return '<span class="pago-badge nao-pago">💰 Não pago</span>';
  if (p.includes('entrada')) return '<span class="pago-badge so-entrada">💰 Só entrada</span>';
  if (p.includes('total')) return '<span class="pago-badge total">💰 Totalmente pago</span>';
  return `<span class="pago-badge so-entrada">💰 ${esc(o.pago)}</span>`;
}

function renderFeatured(order, now) {
  const el = document.getElementById('featured');
  if (!order) { el.innerHTML = '<div class="no-fc">Nenhum pedido para hoje ainda 🎉</div>'; return; }
  const mins = Math.round((order.datetime - now) / 60000);
  const isLate = mins < 0;
  const isEntrega = order.tipo.toLowerCase().includes('entrega');
  const timerTxt = isLate ? `ATRASADO ${Math.abs(mins)}min`
    : mins === 0 ? 'AGORA!'
    : mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}min`
    : `${mins} min`;
  const timerCls = (isLate || mins <= 15) ? 'fc-timer-val urg' : 'fc-timer-val';
  const items = parseItems(order.pedido);
  // Com 2 pedidos "pra agora": setas + bolinhas pra alternar (também troca sozinho a cada 10s)
  const nav = _featList.length > 1 ? `
    <div class="fc-nav">
      <button class="fc-nav-btn" onclick="featNav(-1)">‹</button>
      <div class="fc-dots">${_featList.map((_,i)=>`<span class="fc-dot${i===_featIdx?' on':''}"></span>`).join('')}</div>
      <span class="fc-nav-lbl">${_featIdx+1}/${_featList.length}</span>
      <button class="fc-nav-btn" onclick="featNav(1)">›</button>
    </div>` : '';
  el.innerHTML = `${nav}
    <div class="fc">
      <div class="fc-hdr">
        <span class="fc-badge">${isLate?'ATRASADO':'AGORA'}</span>
        <span class="fc-name">${esc(order.nome)}</span>
        <span class="fc-tipo">${isEntrega?'🛵 Entrega':'🛍️ Retirada'}</span>
      </div>
      ${isLate && !order.entregue ? `<div class="fc-late"><span style="font-size:1.2rem">⚠️</span><span class="fc-late-txt">Pedido atrasado! Marque como entregue.</span><span class="fc-late-min">${Math.abs(mins)}min</span></div>` : ''}
      <div class="fc-body">
        <div class="fc-box"><div class="fc-box-label">Horário</div><div class="fc-box-val hl">${fmtTime(order.datetime)}</div></div>
        <div class="fc-box"><div class="fc-box-label">Data</div><div class="fc-box-val">${fmtDate(order.datetime)}</div></div>
        <div class="fc-box"><div class="fc-box-label">Valor</div><div class="fc-box-val">${esc(fmtMoney(order.valor))}</div></div>
        <div class="fc-timer">
          <div class="fc-timer-lbl">${isLate?'⚠️ Atrasado':'⏳ Tempo restante'}</div>
          <div class="${timerCls}" id="ftimer">${timerTxt}</div>
        </div>
      </div>
      <div class="items-toggle" onclick="this.classList.toggle('open');document.getElementById('fitems').classList.toggle('open')">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,5 7,10 12,5"/></svg>
        Ver itens do pedido
      </div>
      <div class="items-list" id="fitems">${items}</div>
      <div class="fc-foot">
        <div class="fc-phone">📞 ${esc(order.telefone||'—')}</div>
        ${pagoBadge(order)}
        ${order.valorEntrega?`<span style="font-size:.85rem;color:var(--text2)">🛵 ${esc(fmtMoney(order.valorEntrega))}</span>`:''}
        <div class="fc-total">${esc(fmtMoney(order.valor))}</div>
      </div>
      ${!order.entregue
        ? `<button class="btn-deliver${isLate?' late':''}" id="db-${order.id}" onclick="confirmarEntrega('${order.id}')">✔️ Feito</button>`
        : `<div style="text-align:center;color:var(--green);font-size:.82rem;padding:10px 0">✅ Concluído</div>`}
      <button class="btn-print" style="margin:0 18px 16px;width:calc(100% - 36px);justify-content:center" onclick="printOrder('${order.id}')">🖨️ Imprimir Nota</button>
    </div>`;
  startFeaturedTimer(order);
}

function startFeaturedTimer(order) {
  if (window._fti) clearInterval(window._fti);
  window._fti = setInterval(() => {
    const el = document.getElementById('ftimer');
    if (!el) { clearInterval(window._fti); return; }
    const now = new Date();
    const mins = Math.round((order.datetime - now) / 60000);
    const isLate = mins < 0;
    el.className = (isLate || mins <= 15) ? 'fc-timer-val urg' : 'fc-timer-val';
    el.textContent = isLate ? `ATRASADO ${Math.abs(mins)}min`
      : mins === 0 ? 'AGORA!'
      : mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}min`
      : `${mins} min`;
  }, 15000);
}

function renderQueue(list, featured, now) {
  const el = document.getElementById('queue');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div>Sem mais pedidos na fila.</div>';
    return;
  }
  el.innerHTML = list.map((o, i) => {
    const mins = Math.round((o.datetime - now) / 60000);
    const isLate = mins < 0;
    const isEntrega = o.tipo.toLowerCase().includes('entrega');
    const tc = isEntrega ? 'entrega' : 'retirada';
    const isUrg = mins >= 0 && mins <= 60;
    let cd = '', cdcls = '';
    if (o.entregue) { cd = '✅ Feito'; }
    else if (isLate) { cd = `ATRASADO ${Math.abs(mins)}min`; cdcls = 'urg'; }
    else if (mins === 0) { cd = 'AGORA'; cdcls = 'urg'; }
    else if (mins >= 60) { cd = `${Math.floor(mins/60)}h${mins%60?` ${mins%60}min`:''}`; cdcls = ''; }
    else { cd = `${mins}min`; cdcls = isUrg ? 'urg' : 'soon'; }
    const items = parseItems(o.pedido);
    return `
      <div class="qcard ${tc}" style="${o.entregue?'opacity:.4;filter:saturate(0)':''}" onclick="this.querySelector('.qdetails').classList.toggle('open')">
        <div class="qcard-top">
          <span class="qpos">#${i+1}</span>
          <span class="qname">${esc(o.nome)}</span>
          <span class="qtime">${fmtTime(o.datetime)}</span>
        </div>
        <div class="qcard-bot">
          <span class="tag ${tc}">${isEntrega?'🛵 Entrega':'🛍️ Retirada'}</span>
          ${isLate&&!o.entregue?'<span class="tag urgente">⚠️ Atrasado</span>':isUrg&&!o.entregue?'<span class="tag urgente">🔥 Urgente</span>':''}
          ${pagoBadge(o)}
          <span class="qdate">${fmtDate(o.datetime)}</span>
          <span class="qcd ${cdcls}">${cd}</span>
        </div>
        <div class="qdetails">
          ${items}
          ${o.telefone?`<div style="margin-top:7px;font-size:.78rem;color:var(--text3)">📞 ${esc(o.telefone)}</div>`:''}
          ${o.valor?`<div style="font-size:.82rem;color:var(--green);font-weight:700;margin-top:3px">${esc(fmtMoney(o.valor))}</div>`:''}
          ${!o.entregue?`<button class="btn-qdeliver${isLate?' late':''}" id="db-${o.id}" onclick="event.stopPropagation();confirmarEntrega('${o.id}')">✔️ Feito</button>`
          :'<div style="color:var(--green);font-size:.75rem;padding:5px 0">✅ Concluído</div>'}
          <button class="btn-print" style="margin-top:8px" onclick="event.stopPropagation();printOrder('${o.id}')">🖨️ Imprimir</button>
        </div>
      </div>`;
  }).join('');
}

// ── HELPERS ─────────────────────────────────────────────
function fmtTime(dt) { return dt ? new Date(dt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'; }
function fmtDate(dt) { return dt ? new Date(dt).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '—'; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtMoney(v) {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') {
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const s = String(v).trim();
  if (/r\$|,/i.test(s)) return s; // já formatado (ex.: vindo do fallback antigo)
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? s : 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseItems(txt) {
  if (!txt) return '<div style="color:var(--text3);font-size:.78rem">Sem detalhes</div>';
  return String(txt).split('\n').map(l => {
    l = l.trim(); if (!l) return '';
    if (/^[^0-9].+:$/.test(l)) return `<div class="icat">${esc(l.replace(':',''))}</div>`;
    const m = l.match(/^(\d+)\s+(.+)/);
    if (m) return `<div class="irow"><span class="iqty">${m[1]}</span><span class="iname">${esc(m[2])}</span></div>`;
    return `<div class="irow"><span class="iname" style="font-size:.75rem;font-style:italic;color:var(--text3)">${esc(l)}</span></div>`;
  }).join('');
}

// ── PRINT ───────────────────────────────────────────────
function printOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  if (!confirm(`Imprimir nota de ${o.nome}?`)) return;

  const isEntrega = o.tipo.toLowerCase().includes('entrega');
  const tipoLabel = isEntrega ? '🛵 ENTREGA' : '🛍️ RETIRADA';
  const itemsHtml = buildPrintItems(o.pedido);

  document.getElementById('print-area').innerHTML = `
    <div class="p-logo">D'Luh Festas 🍰</div>
    <div class="p-sub">Salgados & Doces para festas</div>
    <div class="p-div"></div>

    <div class="p-row"><span class="p-label">Cliente:</span><span>${esc(o.nome)}</span></div>
    <div class="p-row"><span class="p-label">Fone:</span><span>${esc(o.telefone||'—')}</span></div>
    <div class="p-row"><span class="p-label">Tipo:</span><span>${tipoLabel}</span></div>
    <div class="p-row"><span class="p-label">Data/Hora:</span><span>${fmtDate(o.datetime)} ${fmtTime(o.datetime)}</span></div>

    <div class="p-div"></div>
    <div class="p-section">PEDIDO:</div>
    ${itemsHtml}
    <div class="p-div"></div>

    <div class="p-total">Total: ${esc(fmtMoney(o.valor))}</div>
    <div class="p-div"></div>
    <div class="p-footer">D'Luh Festas agradece seu pedido! ❤️</div>
  `;

  setTimeout(() => window.print(), 100);
}

function buildPrintItems(txt) {
  if (!txt) return '<div class="p-item">—</div>';
  return String(txt).split('\n').map(l => {
    l = l.trim(); if (!l) return '';
    if (/^[^0-9].+:$/.test(l)) return `<div class="p-section">${esc(l)}</div>`;
    return `<div class="p-item">${esc(l)}</div>`;
  }).join('');
}

// ── MOBILE RENDER ───────────────────────────────────────
let mFilter = 'todos';

function setMFilter(f, btn) {
  mFilter = f;
  document.querySelectorAll('.m-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMobile();
}

function renderMobile() {
  const now = new Date();
  const upcoming = orders.filter(o => !o.entregue && o.datetime >= now);
  const lateUndel = orders.filter(o => !o.entregue && o.datetime < now).sort((a,b) => b.datetime - a.datetime);
  const featured = upcoming[0] || lateUndel[0] || null;

  const filtered = orders.filter(o => {
    if (mFilter === 'retirada') return o.tipo.toLowerCase().includes('retirada');
    if (mFilter === 'entrega') return o.tipo.toLowerCase().includes('entrega');
    if (mFilter === 'urgente') { const m = (o.datetime - now) / 60000; return m >= 0 && m <= 60; }
    return true;
  });

  const el = document.getElementById('m-list');
  if (!filtered.length) { el.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text3)">✅ Sem pedidos</div>'; return; }

  el.innerHTML = filtered.map((o, i) => {
    const mins = Math.round((o.datetime - now) / 60000);
    const isLate = mins < 0;
    const isEntrega = o.tipo.toLowerCase().includes('entrega');
    const tipoLabel = isEntrega ? 'Entrega' : 'Retirada';
    const tc = isEntrega ? 'ent' : 'ret';
    let cd = '', cdcls = '';
    if (o.entregue) { cd = '✅ Feito'; }
    else if (isLate) { cd = `ATRASADO ${Math.abs(mins)}min`; cdcls = 'urg'; }
    else if (mins === 0) { cd = 'AGORA'; cdcls = 'urg'; }
    else if (mins >= 60) { cd = `${Math.floor(mins/60)}h${mins%60?` ${mins%60}min`:''}`; }
    else { cd = `${mins}min`; cdcls = (isLate || mins <= 15) ? 'urg' : 'soon'; }
    const isNext = o.id === featured?.id;

    return `
      <div class="m-item${isNext ? ' next' : ''}${o.entregue ? ' delivered' : ''}" onclick="openMModal('${o.id}')">
        <div class="m-bar ${isEntrega ? 'blue' : tc === 'ret' ? 'green' : 'orange'}"></div>
        <div class="m-info">
          <div class="m-name${isNext ? ' next' : o.entregue ? ' done' : ''}">${esc(o.nome)}</div>
          <div class="m-sub">
            <span class="m-tag ${tc}">${tipoLabel}</span>
            ${fmtDate(o.datetime)}
          </div>
        </div>
        <div class="m-right">
          <div class="m-time${isNext ? ' next' : o.entregue ? ' done' : ''}">${fmtTime(o.datetime)}</div>
          <div class="m-cd ${cdcls}">${cd}</div>
        </div>
        ${isNext ? '<div class="m-badge">próximo</div>' : ''}
      </div>`;
  }).join('');

  document.getElementById('m-rlabel').textContent = `✓ ${filtered.length} pedido${filtered.length !== 1 ? 's' : ''}`;
  
  // Mostra botão de imprimir todos
  const printBtn = document.getElementById('m-print-all-btn');
  const pendentes = orders.filter(o => !o.entregue);
  if (window.innerWidth < 600 && pendentes.length > 0) {
    printBtn.style.display = 'block';
  } else {
    printBtn.style.display = 'none';
  }
}

function openMModal(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const isEntrega = o.tipo.toLowerCase().includes('entrega');
  const tipoLabel = isEntrega ? '🛵 Entrega' : '🛍️ Retirada';
  const items = parseItems(o.pedido);
  const now = new Date();
  const mins = Math.round((o.datetime - now) / 60000);
  const isLate = mins < 0;
  let timerTxt = isLate ? `ATRASADO ${Math.abs(mins)}min`
    : mins === 0 ? 'AGORA!'
    : mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}min`
    : `${mins} min`;

  document.getElementById('m-modal-content').innerHTML = `
    <div class="m-modal-hdr">
      <div class="m-modal-name">${esc(o.nome)}</div>
      <div class="m-modal-sub">${tipoLabel} · ${fmtDate(o.datetime)}</div>
    </div>
    <div class="m-modal-body">
      <div class="m-modal-row">
        <div><div class="m-modal-label">Horário</div><div class="m-modal-val hl">${fmtTime(o.datetime)}</div></div>
        <div><div class="m-modal-label">Telefone</div><div class="m-modal-val">${esc(o.telefone || '—')}</div></div>
      </div>
      <div class="m-modal-timer">
        <span class="m-modal-timer-lbl">${isLate ? '⚠️ Atrasado' : '⏳ Tempo'}</span>
        <span class="m-modal-timer-val${(isLate || mins <= 15) ? ' urg' : ''}">${timerTxt}</span>
      </div>
      <div class="m-modal-items">${items}</div>
      <div class="m-modal-row">
        <div><div class="m-modal-label">Total</div><div class="m-modal-val green">${esc(fmtMoney(o.valor))}</div></div>
      </div>
      ${!o.entregue
        ? `<button class="m-modal-btn deliver${isLate ? ' late' : ''}" id="db-${o.id}" onclick="confirmarEntrega('${o.id}')">✔️ Feito</button>`
        : `<div style="text-align:center;color:var(--green);font-size:.82rem;padding:10px 0">✅ Concluído</div>`}
      <button class="m-modal-btn print" onclick="event.stopPropagation();printOrder('${o.id}')">🖨️ Imprimir</button>
    </div>
  `;
  document.getElementById('m-modal-overlay').classList.add('open');
}

function closeMModal(e) {
  if (e.target === document.getElementById('m-modal-overlay')) {
    document.getElementById('m-modal-overlay').classList.remove('open');
  }
}

// ── PRINT ALL ORDERS ─────────────────────────────────────
function printAllOrders() {
  const pendentes = orders.filter(o => !o.entregue);
  if (!pendentes.length) { alert('Nenhum pedido para imprimir'); return; }
  if (!confirm(`Imprimir ${pendentes.length} pedido${pendentes.length !== 1 ? 's' : ''} do dia?`)) return;

  let html = '';
  pendentes.forEach((o, i) => {
    const isEntrega = o.tipo.toLowerCase().includes('entrega');
    const tipoLabel = isEntrega ? '🛵 ENTREGA' : '🛍️ RETIRADA';
    const itemsHtml = buildPrintItems(o.pedido);

    html += `
      <div style="page-break-after:always;page-break-inside:avoid;margin-bottom:10mm">
        <div class="p-logo">D'Luh Festas 🍰</div>
        <div class="p-sub">Salgados & Doces para festas</div>
        <div class="p-div"></div>
        <div class="p-row"><span class="p-label">Cliente:</span><span>${esc(o.nome)}</span></div>
        <div class="p-row"><span class="p-label">Fone:</span><span>${esc(o.telefone||'—')}</span></div>
        <div class="p-row"><span class="p-label">Tipo:</span><span>${tipoLabel}</span></div>
        <div class="p-row"><span class="p-label">Data/Hora:</span><span>${fmtDate(o.datetime)} ${fmtTime(o.datetime)}</span></div>
        <div class="p-div"></div>
        <div class="p-section">PEDIDO:</div>
        ${itemsHtml}
        <div class="p-div"></div>
        <div class="p-total">Total: ${esc(fmtMoney(o.valor))}</div>
        <div class="p-div"></div>
        <div class="p-footer">D'Luh Festas agradece seu pedido! ❤️</div>
      </div>
    `;
  });

  document.getElementById('print-area').innerHTML = html;
  setTimeout(() => window.print(), 100);
}

// ── BOOT ────────────────────────────────────────────────
fetchOrders();
setInterval(fetchOrders, 2 * 60 * 1000);
setInterval(renderAll, 30000);

// Unlock audio on first interaction
['click','keydown','touchstart'].forEach(ev =>
  document.addEventListener(ev, function h() {
    if (!audioUnlocked) unlockAudio();
    document.removeEventListener(ev, h);
  }, { once: true })
);

// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
