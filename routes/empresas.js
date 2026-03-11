const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/empresas - Listar todas as empresas (apenas admin)
router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const result = await pool.query(`
      SELECT id, nome, horario_funcionamento, taxa_entrega, pedido_minimo,
             tempo_entrega_min, tempo_entrega_max, plano, formas_pagamento
      FROM empresas 
      ORDER BY nome ASC
    `);

    res.json({ empresas: result.rows });
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/empresas/geocodificar?endereco=X
router.get('/geocodificar', async (req, res) => {
  try {
    const { endereco } = req.query;
    if (!endereco) return res.status(400).json({ error: 'Endereco obrigatorio.' });
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(endereco)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status !== 'OK') return res.status(400).json({ error: 'Endereco nao encontrado.' });
    const { lat, lng } = data.results[0].geometry.location;
    res.json({ latitude: lat, longitude: lng });
  } catch (error) {
    console.error('Erro ao geocodificar:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/empresas/:id - Buscar empresa específica
router.get('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const result = await pool.query(`
      SELECT id, nome, horario_funcionamento, taxa_entrega, pedido_minimo,
             tempo_entrega_min, tempo_entrega_max, plano, formas_pagamento,
             endereco_restaurante, raio_entrega_km, latitude, longitude
      FROM empresas 
      WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    res.json({ empresa: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar empresa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const { taxa_entrega, tempo_entrega_min, tempo_entrega_max, formas_pagamento, pedido_minimo, endereco_restaurante, raio_entrega_km, latitude, longitude } = req.body;
    const result = await pool.query(`
      UPDATE empresas SET
        taxa_entrega = COALESCE($1, taxa_entrega),
        tempo_entrega_min = COALESCE($2, tempo_entrega_min),
        tempo_entrega_max = COALESCE($3, tempo_entrega_max),
        formas_pagamento = COALESCE($4, formas_pagamento),
        pedido_minimo = COALESCE($5, pedido_minimo),
        endereco_restaurante = COALESCE($6, endereco_restaurante),
        raio_entrega_km = COALESCE($7, raio_entrega_km),
        latitude = COALESCE($8, latitude),
        longitude = COALESCE($9, longitude)
      WHERE id = $10
      RETURNING id, nome, taxa_entrega, tempo_entrega_min, tempo_entrega_max, formas_pagamento, pedido_minimo, endereco_restaurante, raio_entrega_km, latitude, longitude
    `, [taxa_entrega, tempo_entrega_min, tempo_entrega_max, formas_pagamento, pedido_minimo, endereco_restaurante, raio_entrega_km, latitude, longitude, req.params.id]);
    res.json({ empresa: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/empresas/conectar-whatsapp
router.post('/conectar-whatsapp', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { code, phone_number_id, waba_id, empresa_id } = req.body;

    if (!code || !phone_number_id || !waba_id || !empresa_id) {
      return res.status(400).json({ error: 'code, phone_number_id, waba_id e empresa_id são obrigatórios.' });
    }

    // Troca o code pelo access_token via servidor
    const tokenRes = await fetch('https://graph.facebook.com/v22.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: '1719530826122495',
        client_secret: process.env.META_APP_SECRET,
        code,
        redirect_uri: ''
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Erro ao trocar code pelo access_token:', tokenData);
      return res.status(502).json({ error: 'Falha ao obter access_token da Meta.' });
    }

    // Salva na tabela empresas
    await pool.query(`
      UPDATE empresas
      SET whatsapp_access_token = $1,
          phone_number_id       = $2,
          waba_id               = $3
      WHERE id = $4
    `, [tokenData.access_token, phone_number_id, waba_id, empresa_id]);

    res.json({ success: true, phone_number_id });

  } catch (error) {
    console.error('Erro ao conectar WhatsApp:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
