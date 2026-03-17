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
      'SELECT id, nome, horario_funcionamento, taxa_entrega, pedido_minimo, tempo_entrega_min, tempo_entrega_max, whatsapp, foto_capa FROM empresas WHERE id = $1',
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
    const { categoria_id, nome, descricao, preco, disponivel, ordem, destaque, tipo_destaque, desconto_percent, promocao_ativa, is_novo } = req.body;

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
      `INSERT INTO produtos (empresa_id, categoria_id, nome, descricao, preco, disponivel, ordem, imagem_url, destaque, tipo_destaque, desconto_percent, promocao_ativa, is_novo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [empresaId, categoria_id, nome, descricao, preco, disponivel !== false, ordem || 0, imagemUrl,
       destaque === 'true', tipo_destaque || null,
       desconto_percent !== '' && desconto_percent != null ? parseFloat(desconto_percent) : null,
       promocao_ativa === 'true', is_novo === 'true']
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
    const { categoria_id, nome, descricao, preco, disponivel, ordem, destaque, tipo_destaque, desconto_percent, promocao_ativa, is_novo, remover_imagem } = req.body;

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
           destaque = $8, tipo_destaque = $9, desconto_percent = $10, promocao_ativa = $11, is_novo = $12
       WHERE id = $13
       RETURNING *`,
      [categoria_id, nome, descricao, preco, disponivel, ordem, imagemUrl,
       destaque === 'true', tipo_destaque || null,
       desconto_percent !== '' && desconto_percent != null ? parseFloat(desconto_percent) : null,
       promocao_ativa === 'true', is_novo === 'true', id]
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

module.exports = router;
