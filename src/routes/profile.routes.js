// profile.routes.js - Oto Servis Profil ve Ayarlar Rotaları
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const requireAuth = require('../middlewares/requireAuth');
const upload = require('../middlewares/upload');

// Profil Ana Sayfası
router.get('/profil', requireAuth, profileController.getProfilePage);

// Genel Bilgiler Güncelle
router.post('/profil/general', requireAuth, profileController.updateGeneral);

// Konum & Adres Güncelle
router.post('/profil/location', requireAuth, profileController.updateLocation);

// Şifre Güncelle
router.post('/profil/security', requireAuth, profileController.updateSecurity);

// Logo Yükleme
router.post('/profil/logo', requireAuth, upload.single('logo'), profileController.uploadLogo);

// Excel Dışa Aktarma
router.get('/profil/export/customers', requireAuth, profileController.exportCustomers);
router.get('/profil/export/orders', requireAuth, profileController.exportOrders);

module.exports = router;
