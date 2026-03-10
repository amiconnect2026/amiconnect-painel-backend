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

// POST /api/auth/verificar-senha-gerente - Verifica senha do gerente sem emitir token
router.post('/verificar-senha-gerente', authenticateToken, async (req, res) => {
  try {
    const { empresa_id, senha } = req.body;

    if (!empresa_id || !senha) {
      return res.status(400).json({ error: 'empresa_id e senha são obrigatórios.' });
    }

    const result = await pool.query(
      'SELECT senha_gerente FROM empresas WHERE id = $1',
      [empresa_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    if (!result.rows[0].senha_gerente || result.rows[0].senha_gerente !== senha) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    res.json({ ok: true });

  } catch (error) {
    console.error('Erro ao verificar senha gerente:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/auth/gerente - Login do gerente via slug e senha
router.post('/gerente', async (req, res) => {
  try {
    const { empresa_slug, senha_gerente } = req.body;

    if (!empresa_slug || !senha_gerente) {
      return res.status(400).json({ error: 'Slug e senha são obrigatórios.' });
    }

    const result = await pool.query(
      `SELECT id, nome, plano, senha_gerente
       FROM empresas
       WHERE LOWER(REPLACE(nome, ' ', '-')) = LOWER($1)
          OR LOWER(nome) = LOWER($1)`,
      [empresa_slug]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Restaurante não encontrado.' });
    }

    const empresa = result.rows[0];

    if (!empresa.senha_gerente || empresa.senha_gerente !== senha_gerente) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const token = jwt.sign(
      {
        role: 'gerente',
        empresa_id: empresa.id,
        nome: empresa.nome
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      empresa: {
        id: empresa.id,
        nome: empresa.nome,
        plano: empresa.plano
      }
    });

  } catch (error) {
    console.error('Erro no login gerente:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

module.exports = router;
