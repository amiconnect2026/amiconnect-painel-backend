const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use(authenticateToken, filterByTenant);

// GET /api/conversas - Listar conversas ativas
router.get('/', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id || null
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório para admin.' });
    }

    const result = await pool.query(`
      SELECT 
        c.*,
        u.nome as atendente_nome
      FROM conversas c
      LEFT JOIN usuarios u ON c.atendente_id = u.id
      WHERE c.empresa_id = $1 
        AND c.status = 'ativa'
      ORDER BY c.ultima_msg_em DESC
    `, [empresaId]);

    res.json({ conversas: result.rows });
  } catch (error) {
    console.error('Erro ao listar conversas:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PATCH /api/conversas/:telefone/assumir - Assumir conversa
router.patch('/:telefone/assumir', async (req, res) => {
  try {
    const { telefone } = req.params;
    const empresaId = req.user.role === 'admin' 
      ? req.body.empresa_id 
      : req.user.empresa_id;

    const result = await pool.query(`
      UPDATE conversas 
      SET 
        modo = 'manual',
        atendente_id = $1,
        assumido_em = NOW(),
        updated_at = NOW()
      WHERE cliente_telefone = $2 
        AND empresa_id = $3
      RETURNING *
    `, [req.user.id, telefone, empresaId]);

    if (result.rows.length === 0) {
      const createResult = await pool.query(`
        INSERT INTO conversas (
          empresa_id, 
          cliente_telefone, 
          modo, 
          atendente_id,
          assumido_em
        ) VALUES ($1, $2, 'manual', $3, NOW())
        RETURNING *
      `, [empresaId, telefone, req.user.id]);

      // Atualizar sessions para bloquear o bot
      await pool.query(`
        UPDATE sessions 
        SET status = 'humano'
        WHERE empresa_id = $1 
          AND cliente_id = (SELECT id FROM clientes WHERE telefone = $2)
      `, [empresaId, telefone]);

      return res.json({ 
        success: true, 
        conversa: createResult.rows[0],
        message: 'Conversa assumida com sucesso!'
      });
    }

    // Atualizar sessions para bloquear o bot
    await pool.query(`
      UPDATE sessions 
      SET status = 'humano'
      WHERE empresa_id = $1 
        AND cliente_id = (SELECT id FROM clientes WHERE telefone = $2)
    `, [empresaId, telefone]);

    res.json({ 
      success: true, 
      conversa: result.rows[0],
      message: 'Conversa assumida com sucesso!'
    });
  } catch (error) {
    console.error('Erro ao assumir conversa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PATCH /api/conversas/:telefone/liberar - Liberar conversa pro bot
router.patch('/:telefone/liberar', async (req, res) => {
  try {
    const { telefone } = req.params;
    const empresaId = req.user.role === 'admin' 
      ? req.body.empresa_id 
      : req.user.empresa_id;

    const result = await pool.query(`
      UPDATE conversas 
      SET 
        modo = 'bot',
        atendente_id = NULL,
        updated_at = NOW()
      WHERE cliente_telefone = $1 
        AND empresa_id = $2
      RETURNING *
    `, [telefone, empresaId]);

    // Voltar status para ativo na tabela sessions
    await pool.query(`
      UPDATE sessions 
      SET status = 'ativo'
      WHERE empresa_id = $1 
        AND cliente_id = (SELECT id FROM clientes WHERE telefone = $2)
    `, [empresaId, telefone]);

    res.json({ 
      success: true, 
      conversa: result.rows[0],
      message: 'Conversa liberada para o bot!'
    });
  } catch (error) {
    console.error('Erro ao liberar conversa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/mensagens/:telefone - Buscar histórico de mensagens para o chat ao vivo
router.get('/mensagens/:telefone', async (req, res) => {
  try {
    const { telefone } = req.params;
    const empresaId = req.user.role === 'admin'
      ? req.query.empresa_id
      : req.user.empresa_id;

    const result = await pool.query(`
      SELECT m.id, m.role, m.content, m.created_at
      FROM mensagens m
      JOIN clientes c ON m.cliente_id = c.id
      WHERE c.telefone = $1 AND m.empresa_id = $2
      ORDER BY m.created_at ASC
      LIMIT 100
    `, [telefone, empresaId]);

    res.json({ mensagens: result.rows });
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/conversas/mensagens/:telefone - Atendente envia mensagem
router.post('/mensagens/:telefone', async (req, res) => {
  try {
    const { telefone } = req.params;
    const { mensagem } = req.body;
    const empresaId = req.user.role === 'admin'
      ? req.body.empresa_id
      : req.user.empresa_id;

    // Buscar dados da empresa para token da Meta
    const empresaRes = await pool.query(`
      SELECT meta_token, phone_number_id FROM empresas WHERE id = $1
    `, [empresaId]);

    if (empresaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const { meta_token, phone_number_id } = empresaRes.rows[0];

    // Enviar mensagem via Meta API
    const response = await fetch(`https://graph.facebook.com/v22.0/${phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${meta_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: mensagem }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(400).json({ error: 'Erro ao enviar mensagem', details: err });
    }

    // Salvar mensagem no banco
    await pool.query(`
      INSERT INTO mensagens (empresa_id, cliente_id, role, content)
      SELECT $1, id, 'assistant', $2
      FROM clientes WHERE telefone = $3
    `, [empresaId, mensagem, telefone]);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/conversas/config/bot-status - Status global do bot
router.get('/config/bot-status', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id 
      : req.user.empresa_id;

    res.json({ 
      bot_ativo: true,
      empresa_id: empresaId
    });
  } catch (error) {
    console.error('Erro ao verificar status bot:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
