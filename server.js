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

app.use('/api/auth', authRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/conversas', conversasRoutes);
app.use('/api/alertas', alertasRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/empresas', empresasRoutes);

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
