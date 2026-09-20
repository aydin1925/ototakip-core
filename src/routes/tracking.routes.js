const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');

// GET /takip - Müşteri arama formu sorguları (?plaka=...)
router.get('/takip', trackingController.showTrackingPage);

// GET /takip/:plate - Müşterinin WhatsApp'tan tıkladığı canlı takip direkt linki
router.get('/takip/:plate', trackingController.showTrackingPage);

module.exports = router;
