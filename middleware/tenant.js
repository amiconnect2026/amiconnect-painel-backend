// Middleware para filtrar dados por empresa (multi-tenant)
const filterByTenant = (req, res, next) => {
  // Se for admin (empresa_id = null), pode ver tudo
  if (req.user.role === 'admin') {
    req.tenantFilter = {}; // Sem filtro (vê todas empresas)
  } else {
    // Se for gerente, só vê dados da própria empresa
    req.tenantFilter = { empresa_id: req.user.empresa_id };
  }
  
  next();
};

// Validar se usuário tem acesso a um recurso específico
const validateTenantAccess = async (req, res, next, resourceEmpresaId) => {
  // Admin pode acessar tudo
  if (req.user.role === 'admin') {
    return next();
  }

  // Gerente só pode acessar recursos da própria empresa
  if (req.user.empresa_id !== resourceEmpresaId) {
    return res.status(403).json({ 
      error: 'Acesso negado. Você não tem permissão para acessar este recurso.' 
    });
  }

  next();
};

module.exports = { filterByTenant, validateTenantAccess };
