const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');

router.use(authenticateToken, filterByTenant);

function getEmpresaId(req) {
  return req.user.role === 'admin'
    ? (req.body?.empresa_id || req.query?.empresa_id || null)
    : req.user.empresa_id;
}

// ==========================================
// GET /api/biblioteca - Listar grupos da biblioteca
// ==========================================
router.get('/', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    if (!empresaId) return res.status(400).json({ error: 'empresa_id é obrigatório.' });

    const gruposRes = await pool.query(
      'SELECT * FROM biblioteca_grupos WHERE empresa_id = $1 ORDER BY id',
      [empresaId]
    );
    const grupos = gruposRes.rows;
    for (const grupo of grupos) {
      const opcoesRes = await pool.query(
        'SELECT * FROM biblioteca_opcoes WHERE grupo_id = $1 ORDER BY id',
        [grupo.id]
      );
      grupo.opcoes = opcoesRes.rows;
    }
    res.json({ grupos });
  } catch (error) {
    console.error('Erro ao listar biblioteca:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// POST /api/biblioteca/copiar-produto - Copiar complementos de um produto para outros
// ==========================================
router.post('/copiar-produto', async (req, res) => {
  try {
    const { origem_id, destino_ids } = req.body;
    if (!origem_id || !destino_ids?.length) {
      return res.status(400).json({ error: 'origem_id e destino_ids são obrigatórios.' });
    }

    const gruposRes = await pool.query(
      'SELECT * FROM produto_grupos WHERE produto_id = $1 ORDER BY id',
      [origem_id]
    );
    const grupos = gruposRes.rows;
    for (const grupo of grupos) {
      const opcoesRes = await pool.query(
        'SELECT * FROM produto_opcoes WHERE grupo_id = $1 ORDER BY id',
        [grupo.id]
      );
      grupo.opcoes = opcoesRes.rows;
    }

    let copiados = 0;
    for (const destinoId of destino_ids) {
      for (const grupo of grupos) {
        const novoGrupo = await pool.query(
          'INSERT INTO produto_grupos (produto_id, nome, tipo, min_escolhas, max_escolhas) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [destinoId, grupo.nome, grupo.tipo, grupo.min_escolhas, grupo.max_escolhas]
        );
        const novoGrupoId = novoGrupo.rows[0].id;
        for (const opcao of grupo.opcoes) {
          await pool.query(
            'INSERT INTO produto_opcoes (grupo_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4)',
            [novoGrupoId, opcao.nome, opcao.preco_adicional, opcao.disponivel]
          );
        }
      }
      copiados++;
    }

    res.json({ success: true, copiados });
  } catch (error) {
    console.error('Erro ao copiar complementos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// POST /api/biblioteca/aplicar-categoria - Aplicar grupos da biblioteca a uma categoria
// ==========================================
router.post('/aplicar-categoria', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { categoria_id, grupo_ids } = req.body;
    if (!categoria_id || !grupo_ids?.length) {
      return res.status(400).json({ error: 'categoria_id e grupo_ids são obrigatórios.' });
    }

    const produtosRes = await pool.query(
      'SELECT id FROM produtos WHERE categoria_id = $1 AND empresa_id = $2',
      [categoria_id, empresaId]
    );
    const produtos = produtosRes.rows;

    const grupos = [];
    for (const grupoId of grupo_ids) {
      const grupoRes = await pool.query('SELECT * FROM biblioteca_grupos WHERE id = $1', [grupoId]);
      if (grupoRes.rows.length > 0) {
        const grupo = grupoRes.rows[0];
        const opcoesRes = await pool.query(
          'SELECT * FROM biblioteca_opcoes WHERE grupo_id = $1 ORDER BY id',
          [grupoId]
        );
        grupo.opcoes = opcoesRes.rows;
        grupos.push(grupo);
      }
    }

    for (const produto of produtos) {
      for (const grupo of grupos) {
        const novoGrupo = await pool.query(
          'INSERT INTO produto_grupos (produto_id, nome, tipo, min_escolhas, max_escolhas) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [produto.id, grupo.nome, grupo.tipo, grupo.min_escolhas, grupo.max_escolhas]
        );
        const novoGrupoId = novoGrupo.rows[0].id;
        for (const opcao of grupo.opcoes) {
          await pool.query(
            'INSERT INTO produto_opcoes (grupo_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4)',
            [novoGrupoId, opcao.nome, opcao.preco_adicional, opcao.disponivel]
          );
        }
      }
    }

    res.json({ success: true, produtos_afetados: produtos.length });
  } catch (error) {
    console.error('Erro ao aplicar por categoria:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// POST /api/biblioteca - Criar grupo na biblioteca
// ==========================================
router.post('/', async (req, res) => {
  try {
    const empresaId = getEmpresaId(req);
    const { nome, tipo, min_escolhas, max_escolhas } = req.body;
    const result = await pool.query(
      'INSERT INTO biblioteca_grupos (empresa_id, nome, tipo, min_escolhas, max_escolhas) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [empresaId, nome || 'Novo grupo', tipo || 'adicional', min_escolhas ?? 0, max_escolhas ?? 1]
    );
    result.rows[0].opcoes = [];
    res.status(201).json({ success: true, grupo: result.rows[0] });
  } catch (error) {
    console.error('Erro ao criar grupo biblioteca:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// PUT /api/biblioteca/opcoes/:id - ANTES de /:id
// ==========================================
router.put('/opcoes/:id', async (req, res) => {
  try {
    const { nome, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'UPDATE biblioteca_opcoes SET nome = $1, preco_adicional = $2, disponivel = $3 WHERE id = $4 RETURNING *',
      [nome, preco_adicional || 0, disponivel !== false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Opção não encontrada.' });
    res.json({ success: true, opcao: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/biblioteca/opcoes/:id
router.delete('/opcoes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM biblioteca_opcoes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// GET /api/biblioteca/:id
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const grupoRes = await pool.query('SELECT * FROM biblioteca_grupos WHERE id = $1', [req.params.id]);
    if (grupoRes.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado.' });
    const grupo = grupoRes.rows[0];
    const opcoesRes = await pool.query('SELECT * FROM biblioteca_opcoes WHERE grupo_id = $1 ORDER BY id', [req.params.id]);
    grupo.opcoes = opcoesRes.rows;
    res.json({ grupo });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// PUT /api/biblioteca/:id
router.put('/:id', async (req, res) => {
  try {
    const { nome, tipo, min_escolhas, max_escolhas } = req.body;
    const result = await pool.query(
      'UPDATE biblioteca_grupos SET nome = $1, tipo = $2, min_escolhas = $3, max_escolhas = $4 WHERE id = $5 RETURNING *',
      [nome, tipo || 'adicional', min_escolhas ?? 0, max_escolhas ?? 1, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado.' });
    res.json({ success: true, grupo: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// DELETE /api/biblioteca/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM biblioteca_grupos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/biblioteca/:id/opcoes
router.post('/:id/opcoes', async (req, res) => {
  try {
    const { nome, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'INSERT INTO biblioteca_opcoes (grupo_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, nome || 'Nova opção', preco_adicional || 0, disponivel !== false]
    );
    res.status(201).json({ success: true, opcao: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// POST /api/biblioteca/:id/aplicar - Aplicar grupo da biblioteca a produtos
// ==========================================
router.post('/:id/aplicar', async (req, res) => {
  try {
    const { produto_ids } = req.body;
    if (!produto_ids?.length) return res.status(400).json({ error: 'produto_ids é obrigatório.' });

    const grupoRes = await pool.query('SELECT * FROM biblioteca_grupos WHERE id = $1', [req.params.id]);
    if (grupoRes.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado.' });
    const grupo = grupoRes.rows[0];

    const opcoesRes = await pool.query(
      'SELECT * FROM biblioteca_opcoes WHERE grupo_id = $1 ORDER BY id',
      [req.params.id]
    );
    const opcoes = opcoesRes.rows;

    for (const produtoId of produto_ids) {
      const novoGrupo = await pool.query(
        'INSERT INTO produto_grupos (produto_id, nome, tipo, min_escolhas, max_escolhas) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [produtoId, grupo.nome, grupo.tipo, grupo.min_escolhas, grupo.max_escolhas]
      );
      const novoGrupoId = novoGrupo.rows[0].id;
      for (const opcao of opcoes) {
        await pool.query(
          'INSERT INTO produto_opcoes (grupo_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4)',
          [novoGrupoId, opcao.nome, opcao.preco_adicional, opcao.disponivel]
        );
      }
    }

    res.json({ success: true, aplicados: produto_ids.length });
  } catch (error) {
    console.error('Erro ao aplicar grupo biblioteca:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
