// superadmin.routes.js - SaaS SüperAdmin Konsol Rotaları
const express = require('express');
const router = express.Router();
const superadminController = require('../controllers/superadminController');
const requireSuperAdmin = require('../middlewares/requireSuperAdmin');

// Giriş & Çıkış
router.get('/superadmin/login', superadminController.getLoginPage);
router.post('/superadmin/login', superadminController.postLogin);
router.get('/superadmin/logout', superadminController.logout);

// Korumalı Konsol Rotaları
router.get('/superadmin', requireSuperAdmin, superadminController.getDashboard);
router.post('/superadmin/services', requireSuperAdmin, superadminController.createService);
router.post('/superadmin/services/:id/toggle-status', requireSuperAdmin, superadminController.toggleServiceStatus);
router.post('/superadmin/services/:id/capacity', requireSuperAdmin, superadminController.updateServiceCapacity);
router.get('/superadmin/impersonate/:id', requireSuperAdmin, superadminController.impersonate);
router.get('/superadmin/backup', requireSuperAdmin, superadminController.downloadBackup);
router.get('/superadmin/analytics-csv', requireSuperAdmin, superadminController.exportAnalyticsCsv);
router.get('/superadmin/test-whatsapp', requireSuperAdmin, superadminController.testWhatsapp);
router.post('/superadmin/services/:id/profile', requireSuperAdmin, superadminController.updateServiceProfile);

module.exports = router;
