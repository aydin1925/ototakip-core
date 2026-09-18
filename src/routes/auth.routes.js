const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Giriş
router.get('/login', authController.showLoginForm);
router.post('/login', authController.login);

// Kayıt
router.get('/register', authController.showRegisterForm);
router.post('/register', authController.register);

// Çıkış
router.get('/logout', authController.logout);

module.exports = router;
