-- Adiciona coluna habilitado em produto_grupos para toggle sem deletar
ALTER TABLE produto_grupos ADD COLUMN IF NOT EXISTS habilitado BOOLEAN DEFAULT TRUE;
UPDATE produto_grupos SET habilitado = TRUE WHERE habilitado IS NULL;
