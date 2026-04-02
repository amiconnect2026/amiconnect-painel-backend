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

    const result = await pool.query(`
      INSERT INTO sessions (cliente_id, empresa_id, status, origem_pausa, pausado_ate, pos_venda_contatado_em)
      SELECT id, $2, 'humano', $3, NOW() + INTERVAL '10 hours',
        CASE WHEN $3 = 'pos_venda' THEN NOW() ELSE NULL END
      FROM clientes
      WHERE telefone = $1
        AND empresa_id = $2
      ON CONFLICT (cliente_id, empresa_id) DO UPDATE SET
        status = 'humano',
        origem_pausa = $3,
        pausado_ate = NOW() + INTERVAL '10 hours',
        pos_venda_contatado_em = CASE WHEN $3 = 'pos_venda' THEN NOW() ELSE sessions.pos_venda_contatado_em END,
        updated_at = NOW()
    `, [cliente_telefone, empresaId, origem_pausa]);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro sessions/pausar:', error);
    res.status(500).json({ error: 'Erro interno do servidor.', debug: error.message });
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
