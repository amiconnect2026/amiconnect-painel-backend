CREATE TABLE IF NOT EXISTS taxas_entrega (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  distancia_ate_km NUMERIC NOT NULL,
  taxa NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_taxas_entrega_empresa ON taxas_entrega(empresa_id);

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS permite_retirada BOOLEAN DEFAULT true;
