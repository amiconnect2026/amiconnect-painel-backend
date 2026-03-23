const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { filterByTenant } = require('../middleware/tenant');
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../middleware/upload');

// Aplicar autenticação e filtro multi-tenant em todas as rotas exceto cardápio público
router.use((req, res, next) => {
  if (req.path.startsWith('/publico/')) return next();
  authenticateToken(req, res, next);
});

router.use((req, res, next) => {
  if (req.path.startsWith('/publico/')) return next();
  filterByTenant(req, res, next);
});

// ==========================================
// GET /api/produtos/publico/:empresa_id - Cardápio público (sem auth)
// ==========================================
router.get('/publico/:empresa_id', async (req, res) => {
  try {
    const { empresa_id } = req.params;

    // Buscar dados da empresa
    const empresaResult = await pool.query(
      'SELECT id, nome, horario_funcionamento, taxa_entrega, pedido_minimo, tempo_entrega_min, tempo_entrega_max, whatsapp, foto_capa, permite_retirada, tipo_negocio FROM empresas WHERE id = $1',
      [empresa_id]
    );

    if (empresaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    // Buscar produtos disponíveis com categoria
    const produtosResult = await pool.query(`
      SELECT
        p.id, p.nome, p.descricao, p.preco, p.imagem_url, p.disponivel,
        p.destaque, p.tipo_destaque, p.desconto_percent, p.promocao_ativa, p.is_novo,
        p.tipo,
        c.nome as categoria_nome, c.ordem as categoria_ordem,
        CASE WHEN p.promocao_ativa = true AND p.desconto_percent IS NOT NULL
             THEN ROUND((p.preco * (1 - p.desconto_percent / 100.0))::numeric, 2)
             ELSE p.preco END AS preco_final
      FROM produtos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.empresa_id = $1
      ORDER BY c.ordem, p.ordem
    `, [empresa_id]);

    // Buscar faixas de taxa de entrega
    const taxasResult = await pool.query(
      'SELECT distancia_ate_km, taxa FROM taxas_entrega WHERE empresa_id = $1 ORDER BY distancia_ate_km ASC',
      [empresa_id]
    );

    res.json({
      empresa: empresaResult.rows[0],
      produtos: produtosResult.rows,
      taxas_entrega: taxasResult.rows
    });
  } catch (error) {
    console.error('Erro ao buscar cardápio público:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// GET /api/produtos - Listar produtos
// ==========================================
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.*,
        c.nome as categoria_nome
      FROM produtos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.empresa_id = $1
      ORDER BY c.ordem, p.ordem
    `;
    const empresaId = req.user.role === 'admin'
      ? req.query.empresa_id || null
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório para admin.' });
    }

    const result = await pool.query(query, [empresaId]);
    res.json({ produtos: result.rows });
  } catch (error) {
    console.error('Erro ao listar produtos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// GET /api/produtos/:id - Obter 1 produto
// ==========================================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = result.rows[0];
    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    res.json({ produto });
  } catch (error) {
    console.error('Erro ao buscar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// POST /api/produtos - Criar produto (com ou sem imagem)
// ==========================================
router.post('/', upload.single('imagem'), async (req, res) => {
  try {
    const { categoria_id, nome, descricao, preco, disponivel, ordem, destaque, tipo_destaque, desconto_percent, promocao_ativa, is_novo, tipo, combo_num_pizzas } = req.body;

    if (!nome || !preco) {
      return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
    }

    const empresaId = req.user.role === 'admin'
      ? req.body.empresa_id
      : req.user.empresa_id;

    if (!empresaId) {
      return res.status(400).json({ error: 'empresa_id é obrigatório.' });
    }

    // Upload da imagem se enviada
    let imagemUrl = null;
    if (req.file) {
      const resultado = await uploadToCloudinary(req.file.buffer, 'produtos');
      imagemUrl = resultado.secure_url;
    }

    const result = await pool.query(
      `INSERT INTO produtos (empresa_id, categoria_id, nome, descricao, preco, disponivel, ordem, imagem_url, destaque, tipo_destaque, desconto_percent, promocao_ativa, is_novo, tipo, combo_num_pizzas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [empresaId, categoria_id, nome, descricao, preco, disponivel !== false, ordem || 0, imagemUrl,
       destaque === 'true', tipo_destaque || null,
       desconto_percent !== '' && desconto_percent != null ? parseFloat(desconto_percent) : null,
       promocao_ativa === 'true', is_novo === 'true', tipo || 'simples', combo_num_pizzas || null]
    );

    res.status(201).json({ success: true, produto: result.rows[0] });
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// PUT /api/produtos/:id - Editar produto (com ou sem imagem)
// ==========================================
router.put('/:id', upload.single('imagem'), async (req, res) => {
  try {
    const { id } = req.params;
    const { categoria_id, nome, descricao, preco, disponivel, ordem, destaque, tipo_destaque, desconto_percent, promocao_ativa, is_novo, remover_imagem, tipo, combo_num_pizzas } = req.body;

    const checkResult = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = checkResult.rows[0];
    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Upload de nova imagem, remoção ou manter a existente
    let imagemUrl = produto.imagem_url;
    if (req.file) {
      await deleteFromCloudinary(produto.imagem_url);
      const resultado = await uploadToCloudinary(req.file.buffer, 'produtos');
      imagemUrl = resultado.secure_url;
    } else if (remover_imagem === 'true') {
      await deleteFromCloudinary(produto.imagem_url);
      imagemUrl = null;
    }

    const result = await pool.query(
      `UPDATE produtos
       SET categoria_id = $1, nome = $2, descricao = $3, preco = $4,
           disponivel = $5, ordem = $6, imagem_url = $7, updated_at = NOW(),
           destaque = $8, tipo_destaque = $9, desconto_percent = $10, promocao_ativa = $11, is_novo = $12,
           tipo = $13, combo_num_pizzas = $15
       WHERE id = $14
       RETURNING *`,
      [categoria_id, nome, descricao, preco, disponivel, ordem, imagemUrl,
       destaque === 'true', tipo_destaque || null,
       desconto_percent !== '' && desconto_percent != null ? parseFloat(desconto_percent) : null,
       promocao_ativa === 'true', is_novo === 'true', tipo || 'simples', id, combo_num_pizzas || null]
    );

    res.json({ success: true, produto: result.rows[0] });
  } catch (error) {
    console.error('Erro ao editar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// PATCH /api/produtos/:id/toggle - Toggle disponível/indisponível
// ==========================================
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = checkResult.rows[0];
    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const result = await pool.query(
      'UPDATE produtos SET disponivel = NOT disponivel WHERE id = $1 RETURNING *',
      [id]
    );

    // Sync to pizza_sabores if pizza product
    if (result.rows[0].tipo === 'pizza') {
      await pool.query('UPDATE pizza_sabores SET disponivel = $1 WHERE produto_id = $2', [result.rows[0].disponivel, result.rows[0].id]);
    }

    res.json({ success: true, produto: result.rows[0] });
  } catch (error) {
    console.error('Erro ao alternar disponibilidade:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// DELETE /api/produtos/:id - Deletar produto
// ==========================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const produto = checkResult.rows[0];
    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    // Deletar imagem do Cloudinary se existir
    await deleteFromCloudinary(produto.imagem_url);

    await pool.query('DELETE FROM produtos WHERE id = $1', [id]);

    res.json({ success: true, message: 'Produto deletado com sucesso.' });
  } catch (error) {
    console.error('Erro ao deletar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// GET /api/produtos/publico/:produto_id/complementos - Complementos públicos (sem auth)
// ==========================================
router.get('/publico/:produto_id/complementos', async (req, res) => {
  try {
    const { produto_id } = req.params;

    const produtoRes = await pool.query(
      'SELECT id, nome, tipo, preco FROM produtos WHERE id = $1 AND disponivel = true',
      [produto_id]
    );
    if (produtoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const gruposRes = await pool.query(
      'SELECT id, nome, tipo, min_escolhas, max_escolhas FROM produto_grupos WHERE produto_id = $1 ORDER BY id',
      [produto_id]
    );

    const grupos = gruposRes.rows;
    for (const grupo of grupos) {
      const opcoesRes = await pool.query(
        'SELECT id, nome, preco_adicional, disponivel FROM produto_opcoes WHERE grupo_id = $1 AND disponivel = true ORDER BY id',
        [grupo.id]
      );
      grupo.opcoes = opcoesRes.rows;
    }

    res.json({ produto: produtoRes.rows[0], grupos });
  } catch (error) {
    console.error('Erro ao buscar complementos públicos:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// GET /api/produtos/:id/complementos - Complementos (autenticado)
// ==========================================
router.get('/:id/complementos', async (req, res) => {
  try {
    const { id } = req.params;

    const produtoRes = await pool.query('SELECT id, nome, tipo, preco, empresa_id FROM produtos WHERE id = $1', [id]);
    if (produtoRes.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });

    const produto = produtoRes.rows[0];
    if (req.user.role !== 'admin' && produto.empresa_id !== req.user.empresa_id) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const gruposRes = await pool.query(
      'SELECT id, nome, tipo, min_escolhas, max_escolhas FROM produto_grupos WHERE produto_id = $1 ORDER BY id',
      [id]
    );

    const grupos = gruposRes.rows;
    for (const grupo of grupos) {
      const opcoesRes = await pool.query(
        'SELECT * FROM produto_opcoes WHERE grupo_id = $1 ORDER BY id',
        [grupo.id]
      );
      grupo.opcoes = opcoesRes.rows;
    }

    res.json({ produto: produtoRes.rows[0], grupos });
  } catch (error) {
    console.error('Erro ao buscar complementos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// Grupos CRUD
// ==========================================
router.get('/:id/grupos', async (req, res) => {
  try {
    const gruposRes = await pool.query(
      'SELECT id, nome, tipo, min_escolhas, max_escolhas FROM produto_grupos WHERE produto_id = $1 ORDER BY id',
      [req.params.id]
    );
    const grupos = gruposRes.rows;
    for (const grupo of grupos) {
      const opcoesRes = await pool.query(
        'SELECT * FROM produto_opcoes WHERE grupo_id = $1 ORDER BY id',
        [grupo.id]
      );
      grupo.opcoes = opcoesRes.rows;
    }
    res.json({ grupos });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.post('/:id/grupos', async (req, res) => {
  try {
    const { nome, tipo, min_escolhas, max_escolhas } = req.body;
    const result = await pool.query(
      'INSERT INTO produto_grupos (produto_id, nome, tipo, min_escolhas, max_escolhas) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.params.id, nome, tipo || 'adicional', min_escolhas ?? 0, max_escolhas ?? 1]
    );
    result.rows[0].opcoes = [];
    res.status(201).json({ success: true, grupo: result.rows[0] });
  } catch (error) {
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.put('/grupos/:id', async (req, res) => {
  try {
    const { nome, tipo, min_escolhas, max_escolhas } = req.body;
    const result = await pool.query(
      'UPDATE produto_grupos SET nome = $1, tipo = $2, min_escolhas = $3, max_escolhas = $4 WHERE id = $5 RETURNING *',
      [nome, tipo || 'adicional', min_escolhas ?? 0, max_escolhas ?? 1, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado.' });
    res.json({ success: true, grupo: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

router.delete('/grupos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM produto_grupos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// POST /grupos/bulk — Adicionar grupo+opções a múltiplos produtos
// ==========================================
router.post('/grupos/bulk', async (req, res) => {
  try {
    const { produto_ids, grupo } = req.body;
    if (!produto_ids?.length || !grupo?.nome) {
      return res.status(400).json({ error: 'produto_ids e grupo.nome são obrigatórios.' });
    }
    const { nome, tipo, min_escolhas, max_escolhas, opcoes = [] } = grupo;

    for (const produtoId of produto_ids) {
      const novoGrupo = await pool.query(
        'INSERT INTO produto_grupos (produto_id, nome, tipo, min_escolhas, max_escolhas) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [produtoId, nome, tipo || 'adicional', min_escolhas ?? 0, max_escolhas ?? 1]
      );
      const novoGrupoId = novoGrupo.rows[0].id;
      for (const opcao of opcoes) {
        await pool.query(
          'INSERT INTO produto_opcoes (grupo_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4)',
          [novoGrupoId, opcao.nome, opcao.preco_adicional || 0, true]
        );
      }
    }

    res.json({ success: true, aplicados: produto_ids.length });
  } catch (error) {
    console.error('Erro ao adicionar complemento em bulk:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==========================================
// Opções CRUD
// ==========================================
router.post('/grupos/:id/opcoes', async (req, res) => {
  try {
    const { nome, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'INSERT INTO produto_opcoes (grupo_id, nome, preco_adicional, disponivel) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, nome, preco_adicional || 0, disponivel !== false]
    );
    res.status(201).json({ success: true, opcao: result.rows[0] });
  } catch (error) {
    console.error('Erro ao criar opção:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/opcoes/:id', async (req, res) => {
  try {
    const { nome, preco_adicional, disponivel } = req.body;
    const result = await pool.query(
      'UPDATE produto_opcoes SET nome = $1, preco_adicional = $2, disponivel = $3 WHERE id = $4 RETURNING *',
      [nome, preco_adicional || 0, disponivel !== false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Opção não encontrada.' });
    res.json({ success: true, opcao: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar opção:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/opcoes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM produto_opcoes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
