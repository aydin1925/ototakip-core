const workshopService = require('../services/workshopService');

/**
 * Müşteri Canlı Takip Sayfasını Göster (GET /takip/:plate)
 */
function showTrackingPage(req, res) {
    try {
        const rawPlate = req.params.plate;
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
            searchedPlate: req.params.plate
        });
    }
}

module.exports = {
    showTrackingPage
};
