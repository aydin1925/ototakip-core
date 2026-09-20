const workshopService = require('../services/workshopService');

/**
 * Müşteri Canlı Takip Sayfasını Göster (GET /takip/:plate veya GET /takip?plaka=...)
 */
function showTrackingPage(req, res) {
    try {
        const rawPlate = req.params.plate || req.query.plaka;
        
        if (!rawPlate) {
            return res.render('tracking/index', {
                title: 'Araç Takip',
                vehicle: null,
                searchedPlate: ''
            });
        }

        const vehicle = workshopService.getTrackingDataByPlate(rawPlate);

        res.render('tracking/index', {
            title: vehicle ? `${vehicle.plate} - Canlı Takip` : 'Araç Bulunamadı',
            vehicle,
            searchedPlate: rawPlate
        });
    } catch (err) {
        console.error('Takip sayfası hatası:', err.message);
        res.status(500).render('tracking/index', {
            title: 'Hata',
            vehicle: null,
            searchedPlate: req.params.plate || req.query.plaka || ''
        });
    }
}

module.exports = {
    showTrackingPage
};
