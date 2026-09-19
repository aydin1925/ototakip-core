const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const upload = require('../middlewares/upload');

// Lift Paneli
router.get('/dashboard', dashboardController.showDashboard);

// Araç Detay ve İşlemleri
router.get('/arac/:id', dashboardController.showVehicleDetail);
router.post('/arac/:id/stage', dashboardController.updateStage);
router.post('/arac/yeni', dashboardController.createWorkOrder);
router.post('/arac/:id/onay-talep', dashboardController.sendApprovalRequest);
router.post('/arac/:id/mesaj-cevap', dashboardController.replyToCustomer);
router.post('/arac/:id/foto-yukle', upload.single('photo'), dashboardController.uploadVehiclePhoto);

module.exports = router;
