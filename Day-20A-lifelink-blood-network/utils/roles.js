function rolesForAccount(role) {
  if (role === 'donor') return ['donor', 'requester'];
  return role ? [role] : [];
}

function hasRole(user, role) {
  const roles = Array.isArray(user && user.roles)
    ? user.roles
    : rolesForAccount(user && user.role);
  return roles.includes(role);
}

module.exports = { rolesForAccount, hasRole };
