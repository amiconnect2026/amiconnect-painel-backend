const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use(authenticateToken, filterByTenant);

// GET /api/pedidos - Listar pedidos
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id || null
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório para admin.' });
    }

    const { status, data_inicial, data_final, limit = 50 } = req.query;

    let query = `
      SELECT * FROM pedidos 
      WHERE empresa_id = $1
    `;
    
    const params = [empresaId];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (data_inicial) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(data_inicial);
      paramIndex++;
    }

    if (data_final) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(data_final);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({ pedidos: result.rows });

  } catch (error) {
    console.error('Erro ao listar pedidos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/pedidos/:id - Buscar pedido específico
router.get('/:id', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id 
      : req.user.empresa_id;

    const result = await pool.query(`
      SELECT * FROM pedidos 
      WHERE id = $1 AND empresa_id = $2
    `, [req.params.id, empresaId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    // Buscar histórico
    const historico = await pool.query(`
      SELECT * FROM pedidos_historico 
      WHERE pedido_id = $1 
      ORDER BY created_at DESC
    `, [req.params.id]);

    res.json({ 
      pedido: result.rows[0],
      historico: historico.rows
    });

  } catch (error) {
    console.error('Erro ao buscar pedido:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/pedidos - Criar pedido (webhook N8N)
router.post('/', async (req, res) => {
  try {
    const {
      empresa_id,
      cliente_telefone,
      cliente_nome,
      cliente_endereco,
      cliente_bairro,
      itens,
      subtotal,
      taxa_entrega,
      desconto,
      total,
      forma_pagamento,
      troco_para,
      observacoes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO pedidos (
        empresa_id,
        cliente_telefone,
        cliente_nome,
        cliente_endereco,
        cliente_bairro,
        itens,
        subtotal,
        taxa_entrega,
        desconto,
        total,
        forma_pagamento,
        troco_para,
        observacoes,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'confirmado')
      RETURNING *
    `, [
      empresa_id,
      cliente_telefone,
      cliente_nome,
      cliente_endereco,
      cliente_bairro,
      JSON.stringify(itens),
      subtotal,
      taxa_entrega || 0,
      desconto || 0,
      total,
      forma_pagamento,
      troco_para,
      observacoes
    ]);

    // Criar histórico
    await pool.query(`
      INSERT INTO pedidos_historico (pedido_id, status_novo)
      VALUES ($1, 'confirmado')
    `, [result.rows[0].id]);

    // Criar alerta para gerente
    const usuarios = await pool.query(`
      SELECT id FROM usuarios 
      WHERE (empresa_id = $1 OR role = 'admin') AND ativo = true
    `, [empresa_id]);

    for (const usuario of usuarios.rows) {
      await pool.query(`
        INSERT INTO alertas (empresa_id, usuario_id, tipo, titulo, mensagem, link)
        VALUES ($1, $2, 'pedido_confirmado', $3, $4, $5)
      `, [
        empresa_id,
        usuario.id,
        'Novo pedido confirmado!',
        `Cliente ${cliente_nome || cliente_telefone} confirmou pedido de R$ ${total}`,
        `pedidos.html?id=${result.rows[0].id}`
      ]);
    }

    res.json({ 
      success: true, 
      pedido: result.rows[0]
    });

  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PATCH /api/pedidos/:id/status - Atualizar status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, observacao } = req.body;
    const empresaId = req.user.role === 'admin' 
      ? req.body.empresa_id 
      : req.user.empresa_id;

    // Buscar status atual
    const pedidoAtual = await pool.query(`
      SELECT status FROM pedidos WHERE id = $1 AND empresa_id = $2
    `, [req.params.id, empresaId]);

    if (pedidoAtual.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const statusAnterior = pedidoAtual.rows[0].status;

    // Atualizar status
    await pool.query(`
      UPDATE pedidos 
      SET status = $1, updated_at = NOW()
      WHERE id = $2 AND empresa_id = $3
    `, [status, req.params.id, empresaId]);

    // Criar histórico
    await pool.query(`
      INSERT INTO pedidos_historico (pedido_id, status_anterior, status_novo, observacao, usuario_id)
      VALUES ($1, $2, $3, $4, $5)
    `, [req.params.id, statusAnterior, status, observacao, req.user.id]);

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PATCH /api/pedidos/:id/imprimir - Marcar como impresso
router.patch('/:id/imprimir', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.body.empresa_id 
      : req.user.empresa_id;

    await pool.query(`
      UPDATE pedidos 
      SET impresso = true, impresso_em = NOW()
      WHERE id = $1 AND empresa_id = $2
    `, [req.params.id, empresaId]);

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao marcar como impresso:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
