const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// GET /api/bairros
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' ? req.query.empresa_id : req.user.empresa_id;
    const result = await pool.query(
      'SELECT * FROM bairros_entrega WHERE empresa_id = $1 ORDER BY bairro ASC',
      [empresaId]
    );
    res.json({ bairros: result.rows });
  } catch (error) {
    console.error('Erro ao listar bairros:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/bairros/verificar
router.get('/verificar', async (req, res) => {
  try {
    const { bairro, empresa_id } = req.query;
    const result = await pool.query(
      `SELECT * FROM bairros_entrega WHERE empresa_id = $1 AND ativo = true AND LOWER(bairro) = LOWER($2)`,
      [empresa_id, bairro]
    );
    if (result.rows.length === 0) {
      return res.json({ encontrado: false, taxa_entrega: null });
    }
    res.json({ encontrado: true, taxa_entrega: result.rows[0].taxa_entrega, bairro: result.rows[0].bairro });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/bairros
router.post('/', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' ? req.body.empresa_id : req.user.empresa_id;
    const { bairro, taxa_entrega } = req.body;
    const result = await pool.query(
      `INSERT INTO bairros_entrega (empresa_id, bairro, taxa_entrega) VALUES ($1, $2, $3) RETURNING *`,
      [empresaId, bairro, taxa_entrega]
    );
    res.json({ bairro: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PUT /api/bairros/:id
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' ? req.body.empresa_id : req.user.empresa_id;
    const { bairro, taxa_entrega, ativo } = req.body;
    const result = await pool.query(
      `UPDATE bairros_entrega SET bairro = $1, taxa_entrega = $2, ativo = $3, updated_at = NOW() WHERE id = $4 AND empresa_id = $5 RETURNING *`,
      [bairro, taxa_entrega, ativo, req.params.id, empresaId]
    );
    res.json({ bairro: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/bairros/:id
router.delete('/:id', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' ? req.query.empresa_id : req.user.empresa_id;
    await pool.query(
      `DELETE FROM bairros_entrega WHERE id = $1 AND empresa_id = $2`,
      [req.params.id, empresaId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
