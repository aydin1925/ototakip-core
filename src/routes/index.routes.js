const express = require('express');
const router = express.Router();

// GET / - Ürün Karşılama (Landing) Sayfası
router.get('/', (req, res) => {
    // Giriş yapmış ustayı doğrudan panele yönlendir
    if (req.session && req.session.workshopId) {
        return res.redirect('/dashboard');
    }
    res.render('index', { title: 'OtoTakip - Akıllı Servis ve Onay Sistemi' });
});

module.exports = router;
