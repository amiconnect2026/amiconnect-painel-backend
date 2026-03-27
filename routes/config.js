const express = require('express');
const router = express.Router();

// GET /api/config/maps-key?secret=X
router.get('/maps-key', (req, res) => {
  const { secret } = req.query;
  if (!secret || secret !== process.env.MAPS_KEY_SECRET) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Chave não configurada.' });
  }
  res.json({ key });
});

module.exports = router;
