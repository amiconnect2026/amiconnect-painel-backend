const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

// Aplicar autenticação e filtro multi-tenant em todas as rotas
router.use(authenticateToken, filterByTenant);

// GET /api/produtos - Listar produtos
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.*,
        c.nome as categoria_nome
      FROM produtos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.empresa_id = $1
      ORDER BY c.ordem, p.ordem
    `;

    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id || null
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório para admin.' });
    }

    const result = await pool.query(query, [empresaId]);

    res.json({ produtos: result.rows });

  } catch (error) {
    console.error('Erro ao listar produtos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/produtos/:id - Obter 1 produto
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM produtos WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = result.rows[0];

    // Verificar acesso (se não for admin)
    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    res.json({ produto });

  } catch (error) {
    console.error('Erro ao buscar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/produtos - Criar produto
router.post('/', async (req, res) => {
  try {
    const { categoria_id, nome, descricao, preco, disponivel, ordem } = req.body;

    // Validação
    if (!nome || !preco) {
      return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
    }

    const empresaId = req.user.role === 'admin' 
      ? req.body.empresa_id 
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório.' });
    }

    const result = await pool.query(
      `INSERT INTO produtos (empresa_id, categoria_id, nome, descricao, preco, disponivel, ordem) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [empresaId, categoria_id, nome, descricao, preco, disponivel !== false, ordem || 0]
    );

    res.status(201).json({ 
      success: true, 
      produto: result.rows[0] 
    });

  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PUT /api/produtos/:id - Editar produto
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { categoria_id, nome, descricao, preco, disponivel, ordem } = req.body;

    // Verificar se produto existe e se usuário tem acesso
    const checkResult = await pool.query(
      'SELECT * FROM produtos WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = checkResult.rows[0];

    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Atualizar
    const result = await pool.query(
      `UPDATE produtos 
       SET categoria_id = $1, nome = $2, descricao = $3, preco = $4, 
           disponivel = $5, ordem = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [categoria_id, nome, descricao, preco, disponivel, ordem, id]
    );

    res.json({ 
      success: true, 
      produto: result.rows[0] 
    });

  } catch (error) {
    console.error('Erro ao editar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PATCH /api/produtos/:id/toggle - Toggle disponível/indisponível
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar acesso
    const checkResult = await pool.query(
      'SELECT * FROM produtos WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = checkResult.rows[0];

    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Toggle
    const result = await pool.query(
      'UPDATE produtos SET disponivel = NOT disponivel WHERE id = $1 RETURNING *',
      [id]
    );

    res.json({ 
      success: true, 
      produto: result.rows[0] 
    });

  } catch (error) {
    console.error('Erro ao alternar disponibilidade:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/produtos/:id - Deletar produto
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar acesso
    const checkResult = await pool.query(
      'SELECT * FROM produtos WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = checkResult.rows[0];

    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Deletar
    await pool.query('DELETE FROM produtos WHERE id = $1', [id]);

    res.json({ success: true, message: 'Produto deletado com sucesso.' });

  } catch (error) {
    console.error('Erro ao deletar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
