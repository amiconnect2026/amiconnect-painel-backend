#!/bin/bash

# Fazer login e pegar token
echo "🔐 Fazendo login..."
TOKEN=$(curl -s -X POST https://painel.amiconnect.com.br/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@amiconnect.com.br","password":"admin123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "✅ Token obtido!"
echo ""

# Listar conversas
echo "📋 Listando conversas..."
curl -X GET "https://painel.amiconnect.com.br/api/conversas?empresa_id=1" \
  -H "Authorization: Bearer $TOKEN"
echo ""
echo ""

# Assumir conversa
echo "👤 Assumindo conversa..."
curl -X PATCH https://painel.amiconnect.com.br/api/conversas/5541999999999/assumir \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"empresa_id":1}'
echo ""
echo ""

# Listar de novo
echo "📋 Listando conversas novamente..."
curl -X GET "https://painel.amiconnect.com.br/api/conversas?empresa_id=1" \
  -H "Authorization: Bearer $TOKEN"
echo ""
echo ""

# Liberar pro bot
echo "🤖 Liberando pro bot..."
curl -X PATCH https://painel.amiconnect.com.br/api/conversas/5541999999999/liberar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"empresa_id":1}'
echo ""
echo ""

echo ""
echo "✅ Testes concluídos!"
