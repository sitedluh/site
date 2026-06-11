const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  next();
});

app.get('/health', (req, res) => res.send('OK'));

// Usa Google Translate TTS como proxy — servidor não tem restrição de CORS
app.get('/tts', (req, res) => {
  const text = req.query.text || '';
  if (!text) { res.status(400).send('text required'); return; }

  // Divide em chunks de 200 chars (limite do Google TTS)
  const chunks = [];
  const words = text.split(' ');
  let cur = '';
  words.forEach(w => {
    if ((cur + ' ' + w).trim().length > 190) {
      if (cur) chunks.push(cur.trim());
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  });
  if (cur) chunks.push(cur.trim());

  // Se só 1 chunk, proxy direto
  if (chunks.length === 1) {
    proxyGoogleTTS(chunks[0], res);
    return;
  }

  // Múltiplos chunks — retorna o primeiro e inclui os outros no header
  res.setHeader('X-TTS-Chunks', JSON.stringify(chunks.slice(1).map(c =>
    `/tts?text=${encodeURIComponent(c)}`
  )));
  proxyGoogleTTS(chunks[0], res);
});

function proxyGoogleTTS(text, res) {
  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=pt-BR&client=gtx&q=${encodeURIComponent(text)}`;
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TTS-Proxy/1.0)',
      'Referer': 'https://translate.google.com'
    }
  }, (gttsRes) => {
    if (gttsRes.statusCode !== 200) {
      res.status(gttsRes.statusCode).send('TTS error');
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    gttsRes.pipe(res);
  }).on('error', (e) => {
    console.error('Google TTS erro:', e.message);
    res.status(500).send('TTS unavailable');
  });
}

app.listen(PORT, () => console.log(`TTS proxy na porta ${PORT}`));
