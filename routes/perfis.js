const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Rotas públicas (cardápio público, sem auth) ────────────────────────────────

// GET /api/perfis/publico/buscar?telefone=xxx
router.get('/publico/buscar', async (req, res) => {
  try {
    const { telefone } = req.query;
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório.' });

    const result = await pool.query(
      'SELECT id, telefone, nome FROM perfis_clientes WHERE telefone = $1',
      [telefone]
    );

    if (result.rows.length === 0) return res.json({ encontrado: false });

    const perfil = result.rows[0];
    const enderecos = await pool.query(
      'SELECT * FROM perfis_enderecos WHERE perfil_id = $1 ORDER BY principal DESC, created_at DESC',
      [perfil.id]
    );

    res.json({ encontrado: true, perfil, enderecos: enderecos.rows });
  } catch (error) {
    console.error('Erro ao buscar perfil público:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/perfis/publico — criar ou atualizar perfil
router.post('/publico', async (req, res) => {
  try {
    const { telefone, nome } = req.body;
    if (!telefone || !nome) return res.status(400).json({ error: 'telefone e nome são obrigatórios.' });

    const result = await pool.query(`
      INSERT INTO perfis_clientes (telefone, nome)
      VALUES ($1, $2)
      ON CONFLICT (telefone) DO UPDATE SET
        nome = EXCLUDED.nome,
        updated_at = NOW()
      RETURNING *
    `, [telefone, nome]);

    res.json({ perfil: result.rows[0] });
  } catch (error) {
    console.error('Erro ao criar perfil:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/perfis/publico/:id/enderecos
router.get('/publico/:id/enderecos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM perfis_enderecos WHERE perfil_id = $1 ORDER BY principal DESC, created_at DESC',
      [req.params.id]
    );
    res.json({ enderecos: result.rows });
  } catch (error) {
    console.error('Erro ao listar endereços:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/perfis/publico/:id/enderecos — adicionar endereço
router.post('/publico/:id/enderecos', async (req, res) => {
  try {
    const perfil_id = req.params.id;
    const { apelido, rua, numero, bairro, complemento, cidade, lat, lng } = req.body;

    if (!rua || !numero) {
      return res.status(400).json({ error: 'rua e numero são obrigatórios.' });
    }

    // Desmarcar principal anterior
    await pool.query(
      'UPDATE perfis_enderecos SET principal = false WHERE perfil_id = $1',
      [perfil_id]
    );

    const result = await pool.query(`
      INSERT INTO perfis_enderecos (perfil_id, apelido, rua, numero, bairro, complemento, cidade, lat, lng, principal)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
      RETURNING *
    `, [perfil_id, apelido || 'Casa', rua, numero, bairro, complemento || null, cidade || null,
        lat || null, lng || null]);

    res.json({ endereco: result.rows[0] });
  } catch (error) {
    console.error('Erro ao salvar endereço:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/perfis/publico/vincular — vincular perfil ao cliente da empresa
router.post('/publico/vincular', async (req, res) => {
  try {
    const { perfil_id, telefone, empresa_id } = req.body;
    if (!perfil_id || !telefone || !empresa_id) {
      return res.status(400).json({ error: 'perfil_id, telefone e empresa_id são obrigatórios.' });
    }
    await pool.query(
      'UPDATE clientes SET perfil_id = $1 WHERE telefone = $2 AND empresa_id = $3',
      [perfil_id, telefone, empresa_id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao vincular perfil:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ── Rotas autenticadas (painel) ────────────────────────────────────────────────

router.use(authenticateToken);

// GET /api/perfis/buscar?q=xxx — busca por telefone ou nome
router.get('/buscar', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) return res.json({ perfis: [] });

    const result = await pool.query(`
      SELECT
        pc.id, pc.telefone, pc.nome,
        json_agg(pe.* ORDER BY pe.principal DESC, pe.created_at DESC) FILTER (WHERE pe.id IS NOT NULL) as enderecos
      FROM perfis_clientes pc
      LEFT JOIN perfis_enderecos pe ON pe.perfil_id = pc.id
      WHERE pc.telefone ILIKE $1 OR pc.nome ILIKE $1
      GROUP BY pc.id
      ORDER BY pc.nome
      LIMIT 10
    `, [`%${q}%`]);

    res.json({ perfis: result.rows });
  } catch (error) {
    console.error('Erro ao buscar perfis:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/perfis/:id/enderecos
router.get('/:id/enderecos', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM perfis_enderecos WHERE perfil_id = $1 ORDER BY principal DESC, created_at DESC',
      [req.params.id]
    );
    res.json({ enderecos: result.rows });
  } catch (error) {
    console.error('Erro ao listar endereços:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/perfis/enderecos/:id/principal
router.put('/enderecos/:id/principal', async (req, res) => {
  try {
    const { id } = req.params;
    const end = await pool.query('SELECT perfil_id FROM perfis_enderecos WHERE id = $1', [id]);
    if (end.rows.length === 0) return res.status(404).json({ error: 'Endereço não encontrado.' });

    await pool.query('UPDATE perfis_enderecos SET principal = false WHERE perfil_id = $1', [end.rows[0].perfil_id]);
    await pool.query('UPDATE perfis_enderecos SET principal = true WHERE id = $1', [id]);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao marcar principal:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/perfis/enderecos/:id
router.delete('/enderecos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM perfis_enderecos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar endereço:', error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
