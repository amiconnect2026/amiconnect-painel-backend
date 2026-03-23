const pool = require('../config/database');

const WEBHOOK_URL = 'https://n8n.amiconnect.com.br/webhook/followup-cardapio';

async function runFollowup() {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.empresa_id,
        c.telefone,
        c.nome,
        e.phone_number_id
      FROM sessions s
      JOIN clientes c ON c.id = s.cliente_id
      JOIN empresas e ON e.id = s.empresa_id
      WHERE s.cardapio_enviado_em IS NOT NULL
        AND s.cardapio_enviado_em < NOW() - INTERVAL '10 minutes'
        AND s.cardapio_enviado_em >= NOW() - INTERVAL '24 hours'
        AND (s.followup_enviado_em IS NULL OR s.followup_enviado_em < CURRENT_DATE)
        AND NOT EXISTS (
          SELECT 1 FROM pedidos p
          WHERE p.cliente_telefone = c.telefone
            AND p.empresa_id = s.empresa_id
            AND p.created_at >= s.cardapio_enviado_em
        )
        AND (
          e.hora_abertura IS NULL
          OR (NOW() AT TIME ZONE 'America/Sao_Paulo')::TIME
             BETWEEN e.hora_abertura AND e.hora_fechamento
        )
    `);

    for (const row of result.rows) {
      try {
        await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telefone: row.telefone,
            nome: row.nome,
            phone_number_id: row.phone_number_id,
            empresa_id: row.empresa_id
          })
        });

        await pool.query(
          'UPDATE sessions SET followup_enviado_em = NOW() WHERE id = $1',
          [row.id]
        );

        console.log(`✅ Follow-up enviado: ${row.telefone} (empresa ${row.empresa_id})`);
      } catch (err) {
        console.error(`❌ Erro no follow-up ${row.telefone}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Erro no job de follow-up:', error.message);
  }
}

function iniciarFollowup() {
  console.log('⏱️  Job de follow-up iniciado (intervalo: 1 min)');
  runFollowup(); // executa imediatamente no boot
  setInterval(runFollowup, 60 * 1000);
}

module.exports = { iniciarFollowup };
