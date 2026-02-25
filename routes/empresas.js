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

// GET /api/empresas/:id - Buscar empresa específica
router.get('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.empresa_id !== parseInt(req.params.id)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const result = await pool.query(`
      SELECT id, nome, horario_funcionamento, taxa_entrega, pedido_minimo,
             tempo_entrega_min, tempo_entrega_max, plano, formas_pagamento
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

module.exports = router;
