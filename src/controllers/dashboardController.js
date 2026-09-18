const workshopService = require('../services/workshopService');
const sseService = require('../services/sseService');

/**
 * 1. Ana Usta Paneli (Lift Görünümü) - GET /dashboard
 */
function showDashboard(req, res) {
    try {
        const workshopId = req.session.workshopId;
        
        // Atölyenin liftlerindeki aktif araçları ve parça onay durumlarını çek
        const cars = workshopService.getDashboardData(workshopId);

        res.render('dashboard/index', {
            title: 'Lift Kontrol Paneli',
            cars,
            error: null
        });
    } catch (err) {
        console.error('Dashboard yükleme hatası:', err);
        res.status(500).render('dashboard/index', {
            title: 'Lift Kontrol Paneli',
            cars: [],
            error: 'Araç verileri yüklenirken bir sorun oluştu.'
        });
    }
}

/**
 * 2. Tek Bir Aracın 4 Aşamalı Detay Sayfası - GET /arac/:id
 */
function showVehicleDetail(req, res) {
    try {
        const workOrderId = req.params.id;
        const workshopId = req.session.workshopId;

        // Aracın detaylarını, WhatsApp onay geçmişini ve fotoğraflarını getir
        const vehicle = workshopService.getWorkOrderDetail(workOrderId, workshopId);

        res.render('dashboard/detail', {
            title: `${vehicle.plate} - Araç Takip Detayı`,
            vehicle,
            error: null
        });
    } catch (err) {
        // Araç bulunamadıysa veya başka atölyeye aitse dashboard'a yönlendir
        console.error('Araç detay hatası:', err.message);
        res.redirect('/dashboard');
    }
}

/**
 * 3. Araç Aşamasını Değiştir (Kabul -> Teşhis -> Onarım -> Hazır -> Teslim) - POST /arac/:id/stage
 */
function updateStage(req, res) {
    try {
        const workOrderId = req.params.id;
        const { status } = req.body;
        const workshopId = req.session.workshopId;

        // 1. Veritabanını güncelle
        workshopService.updateStage(workOrderId, status, workshopId);

        // 2. Canlı yayına (SSE) haber ver: "X aracının durumu değişti!"
        sseService.broadcast('STAGE_CHANGED', {
            workOrderId: Number(workOrderId),
            newStatus: status
        });

        // 3. Ustayla aynı sayfada kalması için araca geri yönlendir
        res.redirect(`/arac/${workOrderId}`);
    } catch (err) {
        console.error('Aşama güncelleme hatası:', err.message);
        res.redirect(`/arac/${req.params.id}`);
    }
}

/**
 * 4. Yeni Araç Kabulü (İş Emri Aç) - POST /arac/yeni
 */
function createWorkOrder(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const newOrder = workshopService.createWorkOrder(req.body, workshopId);

        // Canlı yayına yeni araç geldiğini bildir
        sseService.broadcast('NEW_VEHICLE', newOrder);

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Yeni araç ekleme hatası:', err.message);
        res.redirect('/dashboard');
    }
}

module.exports = {
    showDashboard,
    showVehicleDetail,
    updateStage,
    createWorkOrder
};
