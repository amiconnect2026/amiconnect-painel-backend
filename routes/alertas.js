const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/alertas - Listar alertas do usuário
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

// GET /api/alertas/nao-lidos - Contar alertas não lidos
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

// PATCH /api/alertas/:id/marcar-lido - Marcar como lido
router.patch('/:id/marcar-lido', async (req, res) => {
  try {
    await pool.query(`
      UPDATE alertas 
      SET lido = true 
      WHERE id = $1 AND usuario_id = $2
    `, [req.params.id, req.user.id]);

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao marcar alerta:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/alertas - Criar alerta (uso interno/webhook)
router.post('/', async (req, res) => {
  try {
    const { empresa_id, tipo, titulo, mensagem, link } = req.body;

    // Buscar usuários da empresa para notificar
    const usuarios = await pool.query(`
      SELECT id FROM usuarios 
      WHERE (empresa_id = $1 OR role = 'admin') AND ativo = true
    `, [empresa_id]);

    // Criar alerta para cada usuário
    for (const usuario of usuarios.rows) {
      await pool.query(`
        INSERT INTO alertas (empresa_id, usuario_id, tipo, titulo, mensagem, link)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [empresa_id, usuario.id, tipo, titulo, mensagem, link]);
    }

    res.json({ success: true, total: usuarios.rows.length });

  } catch (error) {
    console.error('Erro ao criar alerta:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
