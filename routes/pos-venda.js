const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use(authenticateToken, filterByTenant);

function getEmpresaId(req) {
  return req.user.role === 'admin'
    ? (req.query.empresa_id || req.body.empresa_id || null)
    : req.user.empresa_id;
}

// GET /api/pos-venda?empresa_id=X&dias=30
router.get('/', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    const dias = Math.max(1, parseInt(req.query.dias) || 30);

    const result = await pool.query(`
      SELECT
        MAX(p.cliente_nome) AS cliente_nome,
        p.cliente_telefone,
        MAX(p.created_at) AS ultimo_pedido_data,
        EXTRACT(DAY FROM NOW() - MAX(p.created_at))::int AS dias_inativo,
        ROUND(SUM(p.total)::numeric, 2) AS total_gasto,
        ROUND(AVG(p.total)::numeric, 2) AS ticket_medio,
        COALESCE((
          SELECT DATE(s.pos_venda_contatado_em) = CURRENT_DATE
          FROM sessions s
          JOIN clientes cl ON cl.id = s.cliente_id
          WHERE cl.telefone = p.cliente_telefone AND cl.empresa_id = $1
          ORDER BY s.pos_venda_contatado_em DESC NULLS LAST
          LIMIT 1
        ), false) AS contatado_hoje
      FROM pedidos p
      WHERE p.empresa_id = $1
        AND p.status IN ('confirmado', 'entregue', 'saiu_entrega')
      GROUP BY p.cliente_telefone
      HAVING MAX(p.created_at) < NOW() - make_interval(days => $2::int)
      ORDER BY MAX(p.created_at) ASC
      LIMIT 200
    `, [empresaId, dias]);

    const clientes = result.rows;
    const totalInativos = clientes.length;
    const valorPotencial = Math.round(
      clientes.reduce((sum, c) => sum + parseFloat(c.ticket_medio || 0), 0) * 100
    ) / 100;
    const contatadosHoje = clientes.filter(c => c.contatado_hoje).length;

    res.json({ clientes, totalInativos, valorPotencial, contatadosHoje });
  } catch (error) {
    console.error('Erro pos-venda:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
