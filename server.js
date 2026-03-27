const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;

// Exporta io para usar nas rotas
app.set('io', io);

// Middlewares globais
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Rotas
const authRoutes = require('./routes/auth');
const produtosRoutes = require('./routes/produtos');
const categoriasRoutes = require('./routes/categorias');
const conversasRoutes = require('./routes/conversas');
const alertasRoutes = require('./routes/alertas');
const pedidosRoutes = require('./routes/pedidos');
const empresasRoutes = require('./routes/empresas');
const socketRoutes = require('./routes/socket');
const relatoriosRoutes = require('./routes/relatorios');
const perfisRoutes = require('./routes/perfis');
const pizzasRoutes = require('./routes/pizzas');
const taxaEntregaRoutes = require('./routes/taxa-entrega');
const configRoutes = require('./routes/config');
const pool = require('./config/database');

// Auto-migrate: apply pending schema changes safely
async function runMigrations() {
  try {
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS combo_num_pizzas INTEGER DEFAULT 1`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS combo_sabores (
        id SERIAL PRIMARY KEY,
        produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        sabor_id INTEGER NOT NULL REFERENCES pizza_sabores(id) ON DELETE CASCADE,
        UNIQUE(produto_id, sabor_id)
      )
    `);
    await pool.query(`ALTER TABLE pizza_sabores ADD COLUMN IF NOT EXISTS produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE produto_tamanhos ADD COLUMN IF NOT EXISTS pedacos INTEGER`);

    // Tamanhos de pizza como produtos reais (para gestão de complementos e disponibilidade)
    await pool.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tamanho_pizza_id INTEGER REFERENCES produto_tamanhos(id) ON DELETE SET NULL`);

    // Remover produtos criados a partir de sabores (tipo='pizza' sem vínculo com tamanho)
    await pool.query(`DELETE FROM produtos WHERE tipo = 'pizza' AND tamanho_pizza_id IS NULL`);

    // Criar produtos para tamanhos existentes que ainda não têm produto vinculado
    const tamanhosOrfaos = await pool.query(`
      SELECT pt.* FROM produto_tamanhos pt
      WHERE pt.produto_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM produtos p WHERE p.tamanho_pizza_id = pt.id)
    `);
    for (const t of tamanhosOrfaos.rows) {
      let catId = null;
      const catRes = await pool.query(
        `SELECT id FROM categorias WHERE empresa_id = $1 AND LOWER(nome) LIKE '%pizza%' ORDER BY id LIMIT 1`,
        [t.empresa_id]
      );
      if (catRes.rows.length > 0) {
        catId = catRes.rows[0].id;
      } else {
        const newCat = await pool.query(
          `INSERT INTO categorias (empresa_id, nome, ordem) VALUES ($1, 'Pizzas', 99) RETURNING id`,
          [t.empresa_id]
        );
        catId = newCat.rows[0].id;
      }
      await pool.query(
        `INSERT INTO produtos (empresa_id, categoria_id, nome, preco, disponivel, tipo, tamanho_pizza_id, ordem)
         VALUES ($1, $2, $3, $4, true, 'pizza', $5, $6)`,
        [t.empresa_id, catId, t.nome, t.preco, t.id, t.ordem || 0]
      );
    }

    // Remover colunas hora_abertura/hora_fechamento criadas anteriormente (não utilizadas)
    await pool.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS hora_abertura`);
    await pool.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS hora_fechamento`);

    console.log('✅ Migrations aplicadas');
  } catch (e) {
    console.error('❌ Erro nas migrations:', e.message);
  }
}
runMigrations();

app.use('/api/auth', authRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/conversas', conversasRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/socket', socketRoutes);
app.use('/api/relatorios', relatoriosRoutes);
app.use('/api/perfis', perfisRoutes);
app.use('/api/pizzas', pizzasRoutes);
app.use('/api/taxa-entrega', taxaEntregaRoutes);
app.use('/api/config', configRoutes);

// Socket.io - conexões
io.on('connection', (socket) => {
  console.log(`🔌 Socket conectado: ${socket.id}`);

  // Atendente entra em uma sala da empresa
  socket.on('join_empresa', (empresaId) => {
    socket.join(`empresa_${empresaId}`);
    console.log(`👤 Socket ${socket.id} entrou na sala empresa_${empresaId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket desconectado: ${socket.id}`);
  });
});

// Rota raiz
app.get('/', (req, res) => {
  res.json({ 
    message: 'AmiConnect Painel API',
    version: '1.0.0',
    status: 'online'
  });
});

// Rota de health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Tratamento de rotas não encontradas
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// Jobs
const { iniciarFollowup } = require('./jobs/followup');
iniciarFollowup();

// Iniciar servidor
server.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 AmiConnect Painel API');
  console.log(`📡 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`🔌 Socket.io ativo`);
  console.log(`📅 Iniciado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
