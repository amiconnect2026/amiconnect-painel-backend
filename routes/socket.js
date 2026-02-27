const express = require('express');
const router = express.Router();

// POST /api/socket/nova-mensagem - chamado pelo n8n
router.post('/nova-mensagem', (req, res) => {
  const { empresa_id, telefone, nome, mensagem, webhook_secret } = req.body;

  if (webhook_secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`empresa_${empresa_id}`).emit('nova_mensagem', {
      telefone, nome, mensagem, empresa_id
    });
  }

  res.json({ success: true });
});

module.exports = router;
