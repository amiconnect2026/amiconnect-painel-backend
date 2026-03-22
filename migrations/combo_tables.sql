ALTER TABLE produtos ADD COLUMN IF NOT EXISTS combo_num_pizzas INTEGER DEFAULT 1;
CREATE TABLE IF NOT EXISTS combo_sabores (
    id SERIAL PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    sabor_id INTEGER NOT NULL REFERENCES pizza_sabores(id) ON DELETE CASCADE,
    UNIQUE(produto_id, sabor_id)
);
