const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../middleware/upload');

router.use(authenticateToken);

// GET /api/empresas - Listar todas as empresas (apenas admin)
router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const result = await pool.query(`
      SELECT id, nome, horario_funcionamento, taxa_entrega, pedido_minimo,
             tempo_entrega_min, tempo_entrega_max, plano, formas_pagamento,
             ativo, phone_number_id, whatsapp
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

// GET /api/empresas/:id/taxas-entrega
router.get('/:id/taxas-entrega', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const result = await pool.query(
      'SELECT id, distancia_ate_km, taxa FROM taxas_entrega WHERE empresa_id = $1 ORDER BY distancia_ate_km ASC',
      [req.params.id]
    );
    res.json({ taxas: result.rows });
  } catch (error) {
    console.error('Erro ao listar taxas:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/empresas/:id/taxas-entrega
router.post('/:id/taxas-entrega', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const { distancia_ate_km, taxa } = req.body;
    if (!distancia_ate_km || taxa == null) {
      return res.status(400).json({ error: 'distancia_ate_km e taxa são obrigatórios.' });
    }
    const result = await pool.query(
      'INSERT INTO taxas_entrega (empresa_id, distancia_ate_km, taxa) VALUES ($1, $2, $3) RETURNING id, distancia_ate_km, taxa',
      [req.params.id, distancia_ate_km, taxa]
    );
    res.json({ taxa: result.rows[0] });
  } catch (error) {
    console.error('Erro ao adicionar taxa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/empresas/:id/taxas-entrega/:taxaId
router.delete('/:id/taxas-entrega/:taxaId', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    await pool.query(
      'DELETE FROM taxas_entrega WHERE id = $1 AND empresa_id = $2',
      [req.params.taxaId, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover taxa:', error);
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
             endereco_restaurante, raio_entrega_km, latitude, longitude, foto_capa,
             permite_retirada
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
    const { taxa_entrega, tempo_entrega_min, tempo_entrega_max, formas_pagamento, pedido_minimo, endereco_restaurante, raio_entrega_km, latitude, longitude, ativo, nome, whatsapp, plano, senha_gerente, horario_funcionamento, permite_retirada } = req.body;
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
        longitude = COALESCE($9, longitude),
        ativo = COALESCE($11, ativo),
        nome = COALESCE($12, nome),
        whatsapp = COALESCE($13, whatsapp),
        plano = COALESCE($14, plano),
        senha_gerente = COALESCE($15, senha_gerente),
        horario_funcionamento = COALESCE($16, horario_funcionamento),
        permite_retirada = COALESCE($17, permite_retirada)
      WHERE id = $10
      RETURNING id, nome, taxa_entrega, tempo_entrega_min, tempo_entrega_max, formas_pagamento, pedido_minimo, endereco_restaurante, raio_entrega_km, latitude, longitude, ativo, whatsapp, plano, horario_funcionamento, permite_retirada
    `, [taxa_entrega, tempo_entrega_min, tempo_entrega_max, formas_pagamento, pedido_minimo, endereco_restaurante, raio_entrega_km, latitude, longitude, req.params.id, ativo ?? null, nome || null, whatsapp || null, plano || null, senha_gerente || null, horario_funcionamento || null, permite_retirada ?? null]);
    res.json({ empresa: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/empresas/cadastrar
router.post('/cadastrar', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { nome, whatsapp, email, senha, plano, senha_gerente } = req.body;

    if (!nome || !email || !senha || !plano) {
      return res.status(400).json({ error: 'nome, email, senha e plano são obrigatórios.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const empresaResult = await client.query(`
        INSERT INTO empresas (nome, whatsapp, plano, senha_gerente)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [nome, whatsapp || null, plano, senha_gerente || null]);

      const empresa_id = empresaResult.rows[0].id;

      await client.query(`
        INSERT INTO usuarios (empresa_id, email, senha_hash, role)
        VALUES ($1, $2, $3, 'usuario')
      `, [empresa_id, email, senhaHash]);

      await client.query('COMMIT');
      res.json({ success: true, empresa_id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erro ao cadastrar empresa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/empresas/conectar-whatsapp
router.post('/conectar-whatsapp', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const { code, empresa_id } = req.body;

    if (!code || !empresa_id) {
      return res.status(400).json({ error: 'code e empresa_id são obrigatórios.' });
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

    const token = tokenData.access_token;

    // Salva o access_token imediatamente
    await pool.query(
      'UPDATE empresas SET whatsapp_access_token = $1 WHERE id = $2',
      [token, empresa_id]
    );

    // Busca automática de waba_id e phone_number_id
    let waba_id = null;
    let phone_number_id = null;

    try {
      // 1. Obter user_id
      const meRes = await fetch(`https://graph.facebook.com/v22.0/me?fields=id&access_token=${token}`);
      const meData = await meRes.json();
      if (!meData.id) throw new Error('Falha ao obter user_id: ' + JSON.stringify(meData));
      const user_id = meData.id;
      console.log(`[WhatsApp] user_id: ${user_id}`);

      // 2. Obter business_id
      const bizRes = await fetch(`https://graph.facebook.com/v22.0/${user_id}/businesses?access_token=${token}`);
      const bizData = await bizRes.json();
      const business_id = bizData.data?.[0]?.id;
      if (!business_id) throw new Error('Falha ao obter business_id: ' + JSON.stringify(bizData));
      console.log(`[WhatsApp] business_id: ${business_id}`);

      // 3. Obter waba_id
      const wabaRes = await fetch(`https://graph.facebook.com/v22.0/${business_id}/owned_whatsapp_business_accounts?access_token=${token}`);
      const wabaData = await wabaRes.json();
      waba_id = wabaData.data?.[0]?.id;
      if (!waba_id) throw new Error('Falha ao obter waba_id: ' + JSON.stringify(wabaData));
      console.log(`[WhatsApp] waba_id: ${waba_id}`);

      // 4. Obter phone_number_id
      const phoneRes = await fetch(`https://graph.facebook.com/v22.0/${waba_id}/phone_numbers?access_token=${token}`);
      const phoneData = await phoneRes.json();
      phone_number_id = phoneData.data?.[0]?.id;
      if (!phone_number_id) throw new Error('Falha ao obter phone_number_id: ' + JSON.stringify(phoneData));
      console.log(`[WhatsApp] phone_number_id: ${phone_number_id}`);

      // 5. Salvar waba_id e phone_number_id
      await pool.query(
        'UPDATE empresas SET waba_id = $1, phone_number_id = $2 WHERE id = $3',
        [waba_id, phone_number_id, empresa_id]
      );
      console.log(`[WhatsApp] waba_id e phone_number_id salvos para empresa ${empresa_id}`);

      // 6. Subscrever app ao WABA
      try {
        const subRes = await fetch(`https://graph.facebook.com/v22.0/${waba_id}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        const subData = await subRes.json();
        console.log(`[WhatsApp] subscribed_apps:`, subData);
      } catch (subErr) {
        console.error('[WhatsApp] Erro ao subscrever app:', subErr.message);
      }

    } catch (metaErr) {
      console.error('[WhatsApp] Erro ao buscar dados da Meta:', metaErr.message);
    }

    res.json({ success: true, waba_id, phone_number_id });

  } catch (error) {
    console.error('Erro ao conectar WhatsApp:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PATCH /api/empresas/:id/foto-capa
router.patch('/:id/foto-capa', upload.single('foto_capa'), async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const empresaResult = await pool.query('SELECT foto_capa FROM empresas WHERE id = $1', [req.params.id]);
    if (empresaResult.rows.length === 0) return res.status(404).json({ error: 'Empresa não encontrada.' });

    const empresa = empresaResult.rows[0];
    let fotoCapa = empresa.foto_capa;

    if (req.file) {
      await deleteFromCloudinary(empresa.foto_capa);
      const resultado = await uploadToCloudinary(req.file.buffer, 'capas');
      fotoCapa = resultado.secure_url;
    } else if (req.body.remover_foto_capa === 'true') {
      await deleteFromCloudinary(empresa.foto_capa);
      fotoCapa = null;
    }

    await pool.query('UPDATE empresas SET foto_capa = $1 WHERE id = $2', [fotoCapa, req.params.id]);
    res.json({ success: true, foto_capa: fotoCapa });
  } catch (error) {
    console.error('Erro ao atualizar foto de capa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
