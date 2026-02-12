const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
require('dotenv').config();

// POST /api/auth/login - Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validar entrada
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    // Buscar usuário no banco
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND ativo = true',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const user = result.rows[0];

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.senha_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    // Atualizar last_login
    await pool.query(
      'UPDATE usuarios SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Gerar JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        empresa_id: user.empresa_id,
        nome: user.nome
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Retornar token e dados do usuário
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        empresa_id: user.empresa_id
      }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/auth/me - Obter dados do usuário logado
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, email, role, empresa_id, created_at, last_login FROM usuarios WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    res.json({ user: result.rows[0] });

  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/auth/logout - Logout (frontend descarta o token)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Logout realizado com sucesso.' });
});

module.exports = router;
