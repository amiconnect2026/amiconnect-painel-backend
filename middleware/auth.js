const jwt = require('jsonwebtoken');
require('dotenv').config();

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
  // Pegar token do header Authorization
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Acesso negado. Token não fornecido.' 
    });
  }

  // Verificar token
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        error: 'Token inválido ou expirado.' 
      });
    }

    // Adicionar dados do usuário na requisição
    req.user = user;
    next();
  });
};

// Middleware para verificar se é admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Acesso negado. Apenas administradores.' 
    });
  }
  next();
};

module.exports = { authenticateToken, isAdmin };
