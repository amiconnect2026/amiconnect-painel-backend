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
        u.nome as atendente_nome,
        COUNT(m.id) as total_mensagens
      FROM conversas c
      LEFT JOIN usuarios u ON c.atendente_id = u.id
      LEFT JOIN mensagens m ON m.cliente_telefone = c.cliente_telefone 
        AND m.empresa_id = c.empresa_id
      WHERE c.empresa_id = $1 
        AND c.status = 'ativa'
      GROUP BY c.id, u.nome
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
      // Se não existe, criar
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

      return res.json({ 
        success: true, 
        conversa: createResult.rows[0],
        message: 'Conversa assumida com sucesso!'
      });
    }

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

// GET /api/conversas/config/bot-status - Status global do bot
router.get('/config/bot-status', async (req, res) => {
  try {
    const empresaId = req.user.role === 'admin' 
      ? req.query.empresa_id 
      : req.user.empresa_id;

    // Por enquanto, retorna sempre ativo
    // Depois pode adicionar campo na tabela empresas
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
