const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use(authenticateToken, filterByTenant);

function getPeriodoFiltro(periodo) {
  switch (periodo) {
    case 'diario':  return `created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day'`;
    case 'semanal': return `created_at >= NOW() - INTERVAL '7 days'`;
    case 'mensal':  return `created_at >= NOW() - INTERVAL '30 days'`;
    case 'anual':   return `created_at >= NOW() - INTERVAL '365 days'`;
    default:        return `created_at >= NOW() - INTERVAL '30 days'`;
  }
}

async function checkPlano(empresaId) {
  const result = await pool.query(
    `SELECT plano FROM empresas WHERE id = $1`,
    [empresaId]
  );
  return result.rows.length > 0 && result.rows[0].plano === 'profissional';
}

function getEmpresaId(req) {
  return req.user.role === 'admin'
    ? req.query.empresa_id || null
    : req.user.empresa_id;
}

// GET /api/relatorios/faturamento
router.get('/faturamento', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    if (!(await checkPlano(empresaId))) {
      return res.status(403).json({ error: 'Recurso disponível apenas no plano profissional.' });
    }

    const periodoFiltro = getPeriodoFiltro(req.query.periodo);

    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total_pedidos,
        COALESCE(SUM(total), 0) AS faturamento_total,
        COALESCE(AVG(total), 0) AS ticket_medio
      FROM pedidos
      WHERE empresa_id = $1
        AND status IN ('confirmado', 'entregue')
        AND ${periodoFiltro}
    `, [empresaId]);

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Erro ao buscar faturamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/relatorios/itens
router.get('/itens', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    if (!(await checkPlano(empresaId))) {
      return res.status(403).json({ error: 'Recurso disponível apenas no plano profissional.' });
    }

    const periodoFiltro = getPeriodoFiltro(req.query.periodo);

    const result = await pool.query(`
      SELECT
        item->>'nome' AS nome,
        SUM((item->>'quantidade')::numeric)::int AS quantidade_total,
        SUM((item->>'quantidade')::numeric * (item->>'preco')::numeric) AS receita_total
      FROM pedidos,
        jsonb_array_elements(itens) AS item
      WHERE empresa_id = $1
        AND status IN ('confirmado', 'entregue')
        AND ${periodoFiltro}
      GROUP BY item->>'nome'
      ORDER BY quantidade_total DESC
    `, [empresaId]);

    res.json({ itens: result.rows });

  } catch (error) {
    console.error('Erro ao buscar itens:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/relatorios/horario-pico
router.get('/horario-pico', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    if (!(await checkPlano(empresaId))) {
      return res.status(403).json({ error: 'Recurso disponível apenas no plano profissional.' });
    }

    const periodoFiltro = getPeriodoFiltro(req.query.periodo);

    const result = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM created_at)::int AS hora,
        COUNT(*)::int AS quantidade_pedidos
      FROM pedidos
      WHERE empresa_id = $1
        AND status IN ('confirmado', 'entregue')
        AND ${periodoFiltro}
      GROUP BY hora
      ORDER BY hora
    `, [empresaId]);

    res.json({ horarios: result.rows });

  } catch (error) {
    console.error('Erro ao buscar horário de pico:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/relatorios/formas-pagamento
router.get('/formas-pagamento', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    if (!(await checkPlano(empresaId))) {
      return res.status(403).json({ error: 'Recurso disponível apenas no plano profissional.' });
    }

    const periodoFiltro = getPeriodoFiltro(req.query.periodo);

    const result = await pool.query(`
      WITH totais AS (
        SELECT
          forma_pagamento AS forma,
          COUNT(*)::int AS quantidade,
          SUM(total) AS total
        FROM pedidos
        WHERE empresa_id = $1
          AND status IN ('confirmado', 'entregue')
          AND ${periodoFiltro}
        GROUP BY forma_pagamento
      ),
      grand_total AS (
        SELECT SUM(quantidade) AS total_pedidos FROM totais
      )
      SELECT
        t.forma,
        t.quantidade,
        t.total,
        ROUND(t.quantidade::numeric / g.total_pedidos * 100, 2) AS percentual
      FROM totais t, grand_total g
      ORDER BY t.quantidade DESC
    `, [empresaId]);

    res.json({ formas: result.rows });

  } catch (error) {
    console.error('Erro ao buscar formas de pagamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/relatorios/clientes
router.get('/clientes', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    if (!(await checkPlano(empresaId))) {
      return res.status(403).json({ error: 'Recurso disponível apenas no plano profissional.' });
    }

    const periodoFiltro = getPeriodoFiltro(req.query.periodo);

    const result = await pool.query(`
      SELECT
        MAX(cliente_nome) AS cliente_nome,
        cliente_telefone,
        COUNT(*)::int AS total_pedidos,
        SUM(total) AS total_gasto
      FROM pedidos
      WHERE empresa_id = $1
        AND status IN ('confirmado', 'entregue')
        AND ${periodoFiltro}
      GROUP BY cliente_telefone
      ORDER BY total_gasto DESC
      LIMIT 20
    `, [empresaId]);

    res.json({ clientes: result.rows });

  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
