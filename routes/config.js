const express = require('express');
const router = express.Router();

const ALLOWED_ORIGINS = ['https://painel-admin.amiconnect.com.br'];

// GET /api/config/maps-key — restrito por origem (CORS)
// Aceita: requisições sem Origin (mesmo domínio) ou de ALLOWED_ORIGINS
router.get('/maps-key', (req, res) => {
  const origin = req.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Chave não configurada.' });
  }
  res.json({ key });
});

module.exports = router;
