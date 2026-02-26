const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// POST /api/alertas/webhook - Criar alerta via n8n (sem auth JWT)
// ==========================================
router.post('/webhook', async (req, res) => {
  try {
    const { empresa_id, tipo, titulo, mensagem, link, webhook_secret } = req.body;

    if (webhook_secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    if (!empresa_id || !tipo || !titulo) {
      return res.status(400).json({ error: 'empresa_id, tipo e titulo são obrigatórios.' });
    }

    const usuarios = await pool.query(`
      SELECT id FROM usuarios 
      WHERE (empresa_id = $1 OR role = 'admin') AND ativo = true
    `, [empresa_id]);

    for (const usuario of usuarios.rows) {
      await pool.query(`
        INSERT INTO alertas (empresa_id, usuario_id, tipo, titulo, mensagem, link)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [empresa_id, usuario.id, tipo, titulo, mensagem, link]);
    }

    // Emitir evento Socket.io para a empresa
    const io = req.app.get('io');
    if (io) {
      io.to(`empresa_${empresa_id}`).emit('novo_alerta', {
        tipo, titulo, mensagem, empresa_id
      });
    }

    res.json({ success: true, total: usuarios.rows.length });
  } catch (error) {
    console.error('Erro ao criar alerta via webhook:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM alertas 
      WHERE usuario_id = $1 
      ORDER BY created_at DESC 
      LIMIT 50
    `, [req.user.id]);
    res.json({ alertas: result.rows });
  } catch (error) {
    console.error('Erro ao listar alertas:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.get('/nao-lidos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as total 
      FROM alertas 
      WHERE usuario_id = $1 AND lido = false
    `, [req.user.id]);
    res.json({ total: parseInt(result.rows[0].total) });
  } catch (error) {
    console.error('Erro ao contar alertas:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.patch('/:id/marcar-lido', async (req, res) => {
  try {
    await pool.query(`
      UPDATE alertas SET lido = true 
      WHERE id = $1 AND usuario_id = $2
    `, [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao marcar alerta:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { empresa_id, tipo, titulo, mensagem, link } = req.body;

    const usuarios = await pool.query(`
      SELECT id FROM usuarios 
      WHERE (empresa_id = $1 OR role = 'admin') AND ativo = true
    `, [empresa_id]);

    for (const usuario of usuarios.rows) {
      await pool.query(`
        INSERT INTO alertas (empresa_id, usuario_id, tipo, titulo, mensagem, link)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [empresa_id, usuario.id, tipo, titulo, mensagem, link]);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`empresa_${empresa_id}`).emit('novo_alerta', {
        tipo, titulo, mensagem, empresa_id
      });
    }

    res.json({ success: true, total: usuarios.rows.length });
  } catch (error) {
    console.error('Erro ao criar alerta:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
