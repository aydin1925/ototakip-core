// requireSuperAdmin.js - SüperAdmin yetki kontrolü ara yazılımı

function requireSuperAdmin(req, res, next) {
    if (!req.session || !req.session.isSuperAdmin) {
        return res.redirect('/superadmin/login');
    }
    next();
}

module.exports = requireSuperAdmin;
