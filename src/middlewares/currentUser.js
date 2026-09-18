// currentUser.js - Session bilgisini res.locals.currentWorkshop olarak şablonlara aktaran middleware
function currentUser(req, res, next) {
    if(req.session && req.session.workshop) {
        res.locals.currentWorkshop = req.session.workshop;
    } else {
        res.locals.currentWorkshop = null;
    }

    next();
}

module.exports = currentUser;