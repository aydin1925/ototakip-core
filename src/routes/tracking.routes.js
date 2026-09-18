const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');

// GET /takip/:plate - Müşterinin WhatsApp'tan tıkladığı canlı takip linki
router.get('/takip/:plate', trackingController.showTrackingPage);

module.exports = router;
