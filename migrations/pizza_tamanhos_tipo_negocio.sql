-- Permite produto_id NULL para tamanhos globais de pizzaria
ALTER TABLE produto_tamanhos ALTER COLUMN produto_id DROP NOT NULL;

-- Adiciona tipo_negocio na tabela de empresas
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo_negocio VARCHAR(50) DEFAULT 'restaurante';
