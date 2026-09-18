// requireAuth.js - Giriş yapılmamışsa /login'e yönlendiren auth middleware

function requireAuth(req, res, next) {
    // aktif bir oto servis id'si var mı?
    if(!req.session || !req.session.workshopId) {
        // login sayfasına yönlendir
        return res.redirect('/login');
    }

    next();
}

module.exports = requireAuth;