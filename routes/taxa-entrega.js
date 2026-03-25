const express = require('express');
const router = express.Router();
const pool = require('../config/database');

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/taxa-entrega?empresa_id=X&lat=Y&lng=Z  (rota pública)
router.get('/', async (req, res) => {
  try {
    const { empresa_id, lat, lng } = req.query;
    if (!empresa_id || !lat || !lng) {
      return res.status(400).json({ error: 'empresa_id, lat e lng são obrigatórios.' });
    }

    const empresaRes = await pool.query(
      'SELECT taxa_entrega, latitude, longitude, raio_entrega_km FROM empresas WHERE id = $1',
      [empresa_id]
    );
    if (empresaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    const empresa = empresaRes.rows[0];

    const taxasRes = await pool.query(
      'SELECT distancia_ate_km, taxa FROM taxas_entrega WHERE empresa_id = $1 ORDER BY distancia_ate_km ASC',
      [empresa_id]
    );

    // Calcular distância haversine entre cliente e restaurante
    const distancia_km = (empresa.latitude && empresa.longitude)
      ? parseFloat(haversine(
          parseFloat(lat), parseFloat(lng),
          parseFloat(empresa.latitude), parseFloat(empresa.longitude)
        ).toFixed(2))
      : null;

    let taxa = parseFloat(empresa.taxa_entrega || 0);
    let dentro_raio = true;

    if (distancia_km !== null) {
      if (taxasRes.rows.length > 0) {
        // Faixas de distância configuradas: usa a menor faixa que cobre a distância
        const faixa = taxasRes.rows.find(t => distancia_km <= parseFloat(t.distancia_ate_km));
        if (faixa) {
          taxa = parseFloat(faixa.taxa);
        } else {
          dentro_raio = false; // além de todas as faixas
        }
      } else if (empresa.raio_entrega_km) {
        // Sem faixas, apenas raio máximo
        if (distancia_km > parseFloat(empresa.raio_entrega_km)) {
          dentro_raio = false;
        }
      }
      // Se não há faixas nem raio configurado, aceita qualquer distância com taxa padrão
    }

    res.json({
      taxa:         dentro_raio ? taxa : null,
      dentro_raio,
      distancia_km
    });
  } catch (error) {
    console.error('Erro ao calcular taxa de entrega:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
