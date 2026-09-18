const workshopService = require('../services/workshopService');
const sseService = require('../services/sseService');
const { sendApprovalRequestMessage, sendTextMessage } = require('../infrastructure/whatsapp/baileysClient');

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
async function updateStage(req, res) {
    const workOrderId = req.params.id;
    const { status } = req.body;
    const workshopId = req.session.workshopId;

    try {
        // 1. Veritabanını güncelle
        workshopService.updateStage(workOrderId, status, workshopId);

        // 2. Canlı yayına (SSE) haber ver: "X aracının durumu değişti!"
        sseService.broadcast('STAGE_CHANGED', {
            workOrderId: Number(workOrderId),
            newStatus: status
        });

        // 3. Müşteriye WhatsApp Otomatik Aşama Bildirimi Gönder
        try {
            const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);
            if (car && car.customer_phone) {
                let stageMessage = null;
                const trackingUrl = `https://ototakip.com/takip/${car.plate.replace(/\s+/g, '')}`;

                if (status === 'READY') {
                    stageMessage = 
                        `🎉 *Aracınız Teslim Alınmaya Hazır!*\n\n` +
                        `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                        `*${car.plate}* plakalı ${car.car_model} aracınızın tüm bakım ve onarım işlemleri başarıyla tamamlanmıştır.\n\n` +
                        `Aracınızı servisimizden dilediğiniz zaman teslim alabilirsiniz. Keyifli sürüşler dileriz! 🚗✨\n\n` +
                        `🔗 Canlı Takip Detayları: ${trackingUrl}`;
                } else if (status === 'DELIVERED') {
                    stageMessage = 
                        `🤝 *Aracınız Teslim Edildi*\n\n` +
                        `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                        `*${car.plate}* plakalı aracınız bugün teslim edilmiştir. Servisimizi tercih ettiğiniz için teşekkür ederiz.\n\n` +
                        `Kazansız, belasız iyi yolculuklar dileriz! ⭐⭐⭐⭐⭐`;
                } else if (status === 'REPAIRING') {
                    stageMessage = 
                        `🔧 *Onarım ve Montaj Aşaması Başladı*\n\n` +
                        `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                        `*${car.plate}* plakalı aracınızın gerekli parçaları temin edilmiş olup ustanız montaj ve onarım işlemlerine başlamıştır.\n\n` +
                        `🔗 Canlı Takip: ${trackingUrl}`;
                }

                if (stageMessage) {
                    await sendTextMessage(car.customer_phone, stageMessage);
                }
            }
        } catch (waErr) {
            console.warn('[WhatsApp] Aşama bildirim mesajı iletilemedi:', waErr.message);
        }

        // 4. Ustayla aynı sayfada kalması için araca geri yönlendir
        res.redirect(`/arac/${workOrderId}?stageUpdated=1`);
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

/**
 * 5. Müşteriye WhatsApp Parça Onay Talebi Gönder - POST /arac/:id/onay-talep
 */
async function sendApprovalRequest(req, res) {
    const workOrderId = req.params.id;
    const { part_name, note } = req.body;
    const workshopId = req.session.workshopId;

    try {
        if (!part_name) {
            throw new Error('Parça adı zorunludur.');
        }

        // 1. Aracı ve müşteri telefonunu veritabanından çek
        const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);

        // 2. Onay talebini SQLite'a PENDING olarak kaydet
        const newApproval = workshopService.createApprovalRequest(workOrderId, part_name, note);

        // 3. Müşterinin WhatsApp'ına resmi onay mesajını gönder
        try {
            await sendApprovalRequestMessage(car.customer_phone, car, newApproval);
        } catch (waErr) {
            console.warn('WhatsApp mesajı gönderilemedi (bot offline olabilir):', waErr.message);
        }

        // 4. Canlı yayına bildir (tarayıcıdaki usta masasını güncelle)
        sseService.broadcast('NEW_APPROVAL_REQUEST', {
            workOrderId: Number(workOrderId),
            partName: part_name
        });

        res.redirect(`/arac/${workOrderId}?sent=1`);
    } catch (err) {
        console.error('Onay talebi oluşturma hatası:', err.message);
        res.redirect(`/arac/${workOrderId}?error=${encodeURIComponent(err.message)}`);
    }
}

/**
 * 6. Müşterinin Sorusuna WhatsApp'tan Cevap Yaz - POST /arac/:id/mesaj-cevap
 */
async function replyToCustomer(req, res) {
    const workOrderId = req.params.id;
    const { reply_text } = req.body;
    const workshopId = req.session.workshopId;

    try {
        if (!reply_text || !reply_text.trim()) {
            throw new Error('Lütfen müşteriye gönderilecek cevabı yazınız.');
        }

        // 1. Aracı ve müşteri numarasını getir
        const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);

        // 2. Cevabı veritabanına MECHANIC olarak kaydet
        workshopService.saveMechanicReply(workOrderId, reply_text);

        // 3. Müşterinin telefonuna resmi WhatsApp yanıtını gönder
        try {
            const messageBody = `👨‍🔧 *Ustanızdan Bilgilendirme*\n\nSayın *${car.customer_name || 'Müşterimiz'}*,\n${reply_text.trim()}`;
            await sendTextMessage(car.customer_phone, messageBody);
        } catch (waErr) {
            console.warn('WhatsApp yanıt mesajı iletilemedi:', waErr.message);
        }

        // 4. Canlı yayına bildir (sohbeti güncelle)
        sseService.broadcast('REPLY_SENT', {
            workOrderId: Number(workOrderId),
            text: reply_text.trim()
        });

        res.redirect(`/arac/${workOrderId}?replied=1`);
    } catch (err) {
        console.error('Müşteri yanıtlama hatası:', err.message);
        res.redirect(`/arac/${workOrderId}?error=${encodeURIComponent(err.message)}`);
    }
}

module.exports = {
    showDashboard,
    showVehicleDetail,
    updateStage,
    createWorkOrder,
    sendApprovalRequest,
    replyToCustomer
};
