const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use(authenticateToken, filterByTenant);

function getEmpresaId(req) {
  return req.user.role === 'admin'
    ? (req.body.empresa_id || null)
    : req.user.empresa_id;
}

// POST /api/sessions/pausar
router.post('/pausar', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { cliente_telefone, horas = 10, origem_pausa = 'manual' } = req.body;

    if (!empresaId || !cliente_telefone) {
      return res.status(400).json({ error: 'empresa_id e cliente_telefone são obrigatórios.' });
    }

    await pool.query(`
      UPDATE sessions SET
        status = 'humano',
        origem_pausa = $3,
        pausado_ate = NOW() + make_interval(hours => $4::int),
        pos_venda_contatado_em = CASE WHEN $3 = 'pos_venda' THEN NOW() ELSE pos_venda_contatado_em END
      WHERE empresa_id = $1
        AND cliente_id = (SELECT id FROM clientes WHERE telefone = $2 AND empresa_id = $1 LIMIT 1)
    `, [empresaId, cliente_telefone, origem_pausa, horas]);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro sessions/pausar:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/sessions/verificar-pausa
router.post('/verificar-pausa', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    const result = await pool.query(`
      UPDATE sessions SET
        status = 'ativo',
        origem_pausa = NULL,
        pausado_ate = NULL
      WHERE empresa_id = $1
        AND pausado_ate IS NOT NULL
        AND pausado_ate < NOW()
        AND status = 'humano'
      RETURNING id
    `, [empresaId]);

    res.json({ success: true, reativadas: result.rowCount });
  } catch (error) {
    console.error('Erro sessions/verificar-pausa:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
