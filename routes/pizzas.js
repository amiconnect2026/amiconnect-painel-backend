const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use((req, res, next) => {
  if (req.path.startsWith('/publico/')) return next();
  authenticateToken(req, res, next);
});

router.use((req, res, next) => {
  if (req.path.startsWith('/publico/')) return next();
  filterByTenant(req, res, next);
});

function getEmpresaId(req) {
  return req.user?.role === 'admin'
    ? (req.query.empresa_id || req.body.empresa_id)
    : req.user?.empresa_id;
}

// ==========================================
// GET /api/pizzas/publico/:empresa_id
// ==========================================
router.get('/publico/:empresa_id', async (req, res) => {
  try {
    const { empresa_id } = req.params;

    const [tamanhos, subcategorias, bordas, configs] = await Promise.all([
      pool.query('SELECT * FROM produto_tamanhos WHERE empresa_id = $1 AND produto_id IS NULL ORDER BY ordem', [empresa_id]),
      pool.query('SELECT * FROM pizza_subcategorias WHERE empresa_id = $1 ORDER BY id', [empresa_id]),
      pool.query('SELECT * FROM pizza_bordas WHERE empresa_id = $1 AND disponivel = true ORDER BY id', [empresa_id]),
      pool.query(
        'SELECT pc.produto_id, pc.tem_borda FROM pizza_config pc JOIN produtos p ON pc.produto_id = p.id WHERE p.empresa_id = $1',
        [empresa_id]
      )
    ]);

    const subcatsWithSabores = await Promise.all(
      subcategorias.rows.map(async (sc) => {
        const saboresRes = await pool.query(
          'SELECT * FROM pizza_sabores WHERE subcategoria_id = $1 AND disponivel = true ORDER BY id',
          [sc.id]
        );
        const saboresWithPrecos = await Promise.all(
          saboresRes.rows.map(async (s) => {
            const precos = await pool.query('SELECT * FROM pizza_sabor_precos WHERE sabor_id = $1', [s.id]);
            return { ...s, precos: precos.rows };
          })
        );
        return { ...sc, sabores: saboresWithPrecos };
      })
    );

    // configs as object: { produto_id: tem_borda }
    const configsMap = {};
    configs.rows.forEach(c => { configsMap[c.produto_id] = c.tem_borda; });

    res.json({
      tamanhos: tamanhos.rows,
      subcategorias: subcatsWithSabores,
      bordas: bordas.rows,
      configs: configsMap
    });
  } catch (error) {
    console.error('Erro ao buscar dados pizza público:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TAMANHOS (produto_tamanhos por empresa)
// ==========================================
router.get('/tamanhos', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const result = await pool.query('SELECT * FROM produto_tamanhos WHERE empresa_id = $1 AND produto_id IS NULL ORDER BY ordem', [empresaId]);
    res.json({ tamanhos: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tamanhos', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nome, preco, max_sabores, ordem } = req.body;
    const result = await pool.query(
      'INSERT INTO produto_tamanhos (empresa_id, nome, max_sabores, preco, disponivel, ordem) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [empresaId, nome, max_sabores || 1, preco, true, ordem || 0]
    );
    res.status(201).json({ success: true, tamanho: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/tamanhos/:id', async (req, res) => {
  try {
    const { nome, preco, max_sabores } = req.body;
    const result = await pool.query(
      'UPDATE produto_tamanhos SET nome = $1, preco = $2, max_sabores = $3 WHERE id = $4 RETURNING *',
      [nome, preco, max_sabores || 1, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tamanho não encontrado.' });
    res.json({ success: true, tamanho: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/tamanhos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM produto_tamanhos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SUBCATEGORIAS
// ==========================================
router.get('/subcategorias', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const result = await pool.query('SELECT * FROM pizza_subcategorias WHERE empresa_id = $1 ORDER BY id', [empresaId]);
    res.json({ subcategorias: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/subcategorias', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nome } = req.body;
    const result = await pool.query(
      'INSERT INTO pizza_subcategorias (empresa_id, nome) VALUES ($1, $2) RETURNING *',
      [empresaId, nome]
    );
    res.status(201).json({ success: true, subcategoria: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/subcategorias/:id', async (req, res) => {
  try {
    const { nome } = req.body;
    const result = await pool.query(
      'UPDATE pizza_subcategorias SET nome = $1 WHERE id = $2 RETURNING *',
      [nome, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Subcategoria não encontrada.' });
    res.json({ success: true, subcategoria: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/subcategorias/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pizza_subcategorias WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SABORES
// ==========================================
router.get('/sabores', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { subcategoria_id } = req.query;
    let q = `SELECT ps.*, sc.nome as subcategoria_nome
             FROM pizza_sabores ps
             LEFT JOIN pizza_subcategorias sc ON ps.subcategoria_id = sc.id
             WHERE ps.empresa_id = $1`;
    const params = [empresaId];
    if (subcategoria_id) { q += ' AND ps.subcategoria_id = $2'; params.push(subcategoria_id); }
    q += ' ORDER BY ps.id';
    const result = await pool.query(q, params);
    res.json({ sabores: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sabores', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { subcategoria_id, nome, descricao, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'INSERT INTO pizza_sabores (empresa_id, subcategoria_id, nome, descricao, preco_adicional, disponivel) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [empresaId, subcategoria_id || null, nome, descricao || null, preco_adicional || 0, disponivel !== false]
    );
    res.status(201).json({ success: true, sabor: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/sabores/:id', async (req, res) => {
  try {
    const { subcategoria_id, nome, descricao, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'UPDATE pizza_sabores SET subcategoria_id = $1, nome = $2, descricao = $3, preco_adicional = $4, disponivel = $5 WHERE id = $6 RETURNING *',
      [subcategoria_id || null, nome, descricao || null, preco_adicional || 0, disponivel !== false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sabor não encontrado.' });
    res.json({ success: true, sabor: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/sabores/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pizza_sabores WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BORDAS
// ==========================================
router.get('/bordas', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const result = await pool.query('SELECT * FROM pizza_bordas WHERE empresa_id = $1 ORDER BY id', [empresaId]);
    res.json({ bordas: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bordas', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nome, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'INSERT INTO pizza_bordas (empresa_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4) RETURNING *',
      [empresaId, nome, preco_adicional || 0, disponivel !== false]
    );
    res.status(201).json({ success: true, borda: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/bordas/:id', async (req, res) => {
  try {
    const { nome, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'UPDATE pizza_bordas SET nome = $1, preco_adicional = $2, disponivel = $3 WHERE id = $4 RETURNING *',
      [nome, preco_adicional || 0, disponivel !== false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Borda não encontrada.' });
    res.json({ success: true, borda: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/bordas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM pizza_bordas WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SABOR PRECOS (pizza_sabor_precos)
// ==========================================
router.get('/sabores/:id/precos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pizza_sabor_precos WHERE sabor_id = $1', [req.params.id]);
    res.json({ precos: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sabores/:id/precos', async (req, res) => {
  try {
    const saborId = req.params.id;
    const { precos } = req.body; // [{ tamanho_id, preco_adicional }]
    await pool.query('DELETE FROM pizza_sabor_precos WHERE sabor_id = $1', [saborId]);
    if (precos && precos.length > 0) {
      for (const p of precos) {
        if (p.preco_adicional !== null && p.preco_adicional !== undefined) {
          await pool.query(
            'INSERT INTO pizza_sabor_precos (sabor_id, tamanho_id, preco_adicional) VALUES ($1, $2, $3)',
            [saborId, p.tamanho_id, p.preco_adicional]
          );
        }
      }
    }
    const result = await pool.query('SELECT * FROM pizza_sabor_precos WHERE sabor_id = $1', [saborId]);
    res.json({ success: true, precos: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CONFIG PIZZA (por produto)
// ==========================================
router.get('/config/:produto_id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pizza_config WHERE produto_id = $1', [req.params.produto_id]);
    res.json({ config: result.rows[0] || { produto_id: parseInt(req.params.produto_id), tem_borda: false } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config/:produto_id', async (req, res) => {
  try {
    const { tem_borda } = req.body;
    const check = await pool.query('SELECT id FROM pizza_config WHERE produto_id = $1', [req.params.produto_id]);
    let result;
    if (check.rows.length > 0) {
      result = await pool.query(
        'UPDATE pizza_config SET tem_borda = $1 WHERE produto_id = $2 RETURNING *',
        [tem_borda, req.params.produto_id]
      );
    } else {
      result = await pool.query(
        'INSERT INTO pizza_config (produto_id, tem_borda) VALUES ($1, $2) RETURNING *',
        [req.params.produto_id, tem_borda]
      );
    }
    res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
