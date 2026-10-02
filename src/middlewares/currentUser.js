// currentUser.js - Session bilgisini res.locals'a aktaran middleware
function currentUser(req, res, next) {
    if (req.session && req.session.workshop) {
        res.locals.currentWorkshop = req.session.workshop;
    } else {
        res.locals.currentWorkshop = null;
    }

    res.locals.isImpersonated = Boolean(req.session && req.session.impersonatedByAdmin);
    res.locals.isSuperAdmin = Boolean(req.session && req.session.isSuperAdmin);

    next();
}

module.exports = currentUser;