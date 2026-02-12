const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

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

app.use('/api/auth', authRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/categorias', categoriasRoutes);

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
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 AmiConnect Painel API');
  console.log(`📡 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log(`📅 Iniciado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
