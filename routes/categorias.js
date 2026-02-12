const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

// Aplicar autenticação e filtro multi-tenant
router.use(authenticateToken, filterByTenant);

// GET /api/categorias - Listar categorias
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id || null
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório para admin.' });
    }

    const result = await pool.query(
      'SELECT * FROM categorias WHERE empresa_id = $1 ORDER BY ordem',
      [empresaId]
    );

    res.json({ categorias: result.rows });

  } catch (error) {
    console.error('Erro ao listar categorias:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/categorias - Criar categoria
router.post('/', async (req, res) => {
  try {
    const { nome, descricao, ordem } = req.body;

    if (!nome) {
      return res.status(400).json({ error: 'Nome é obrigatório.' });
    }

    const empresaId = req.user.role === 'admin' 
      ? req.body.empresa_id 
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório.' });
    }

    const result = await pool.query(
      `INSERT INTO categorias (empresa_id, nome, descricao, ordem) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [empresaId, nome, descricao, ordem || 0]
    );

    res.status(201).json({ 
      success: true, 
      categoria: result.rows[0] 
    });

  } catch (error) {
    console.error('Erro ao criar categoria:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PUT /api/categorias/:id - Editar categoria
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, ordem, ativo } = req.body;

    // Verificar acesso
    const checkResult = await pool.query(
      'SELECT * FROM categorias WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    const categoria = checkResult.rows[0];

    if (req.user.role !== 'admin' && categoria.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Atualizar
    const result = await pool.query(
      `UPDATE categorias 
       SET nome = $1, descricao = $2, ordem = $3, ativo = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [nome, descricao, ordem, ativo, id]
    );

    res.json({ 
      success: true, 
      categoria: result.rows[0] 
    });

  } catch (error) {
    console.error('Erro ao editar categoria:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/categorias/:id - Deletar categoria
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar acesso
    const checkResult = await pool.query(
      'SELECT * FROM categorias WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    const categoria = checkResult.rows[0];

    if (req.user.role !== 'admin' && categoria.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Verificar se tem produtos vinculados
    const produtosResult = await pool.query(
      'SELECT COUNT(*) FROM produtos WHERE categoria_id = $1',
      [id]
    );

    if (parseInt(produtosResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Não é possível deletar categoria com produtos vinculados.' 
      });
    }

    // Deletar
    await pool.query('DELETE FROM categorias WHERE id = $1', [id]);

    res.json({ success: true, message: 'Categoria deletada com sucesso.' });

  } catch (error) {
    console.error('Erro ao deletar categoria:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
