const express = require('express');
const router = express.Router();
const sseService = require('../services/sseService');

// GET /api/events - Tarayıcının canlı bildirim dinleme hattı
router.get('/api/events', (req, res) => {
    sseService.addClient(req, res);
});

module.exports = router;
