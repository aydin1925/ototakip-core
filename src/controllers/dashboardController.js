const workshopService = require('../services/workshopService');
const sseService = require('../services/sseService');
const { sendApprovalRequestMessage, sendTextMessage, sendImageMessage, sendServiceReceiptMessage } = require('../infrastructure/whatsapp/baileysClient');

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
    const { status, send_whatsapp } = req.body;
    const workshopId = req.session.workshopId;

    try {
        // 1. Veritabanını güncelle
        workshopService.updateStage(workOrderId, status, workshopId);

        // 2. Canlı yayına (SSE) haber ver: "X aracının durumu değişti!"
        sseService.broadcast('STAGE_CHANGED', {
            workOrderId: Number(workOrderId),
            newStatus: status
        });

        // 3. Müşteriye WhatsApp Otomatik Aşama Bildirimi Gönder (İptal edilmediyse)
        const shouldSendWa = send_whatsapp !== '0' && send_whatsapp !== 'false';
        if (shouldSendWa) {
            try {
                const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);
                if (car && car.customer_phone) {
                    let stageMessage = null;
                    const trackingUrl = `https://ototakip.com/takip/${car.plate.replace(/\s+/g, '')}`;

                    if (status === 'RECEIVED') {
                        stageMessage = 
                            `📋 *Servis Kabulü Yapıldı*\n\n` +
                            `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                            `*${car.plate}* plakalı aracınızın servis kabulü ve iş emri kaydı açılmıştır. Aracınız lift sırasına alınmıştır.\n\n` +
                            `🔗 Canlı Takip: ${trackingUrl}`;
                    } else if (status === 'INSPECTING') {
                        stageMessage = 
                            `🔍 *Arıza Tespiti ve Kontroller Başladı*\n\n` +
                            `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                            `*${car.plate}* plakalı aracınız lift üzerine alınmış olup ustanız detaylı kontrolleri ve arıza tespitini sürdürmektedir.\n\n` +
                            `🔗 Canlı Takip: ${trackingUrl}`;
                    } else if (status === 'WAITING_PARTS') {
                        stageMessage = 
                            `📦 *Yedek Parça Siparişi Verildi*\n\n` +
                            `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                            `*${car.plate}* plakalı aracınız için gerekli yedek parçaların siparişi verilmiştir. Parçalar servisimize ulaştığında derhal montaj işlemine başlanacaktır.\n\n` +
                            `🔗 Canlı Takip: ${trackingUrl}`;
                    } else if (status === 'REPAIRING') {
                        stageMessage = 
                            `🔧 *Onarım ve Montaj Aşaması Başladı*\n\n` +
                            `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                            `*${car.plate}* plakalı aracınızın gerekli işlemleri ve parça montajına başlanmıştır.\n\n` +
                            `🔗 Canlı Takip: ${trackingUrl}`;
                    } else if (status === 'TESTING') {
                        stageMessage = 
                            `🚗 *Yol Testi ve Son Kontroller Yapılıyor*\n\n` +
                            `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                            `*${car.plate}* plakalı aracınızın montaj ve onarım işlemleri tamamlanmış olup ustanız tarafından yol testi ve son kontrolleri gerçekleştirilmektedir.\n\n` +
                            `🔗 Canlı Takip: ${trackingUrl}`;
                    } else if (status === 'READY') {
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
                    }

                    if (stageMessage) {
                        await sendTextMessage(car.customer_phone, stageMessage);
                    }
                }
            } catch (waErr) {
                console.warn('[WhatsApp] Aşama bildirim mesajı iletilemedi:', waErr.message);
            }
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
async function createWorkOrder(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const newOrder = workshopService.createWorkOrder(req.body, workshopId);

        // Canlı yayına yeni araç geldiğini bildir
        sseService.broadcast('NEW_VEHICLE', newOrder);

        // Müşteriye WhatsApp Karşılama ve Canlı Takip Mesajı Gönder
        const { send_welcome_whatsapp } = req.body;
        const shouldSendWelcome = send_welcome_whatsapp !== '0' && send_welcome_whatsapp !== 'false';

        if (shouldSendWelcome && newOrder.customer_phone) {
            try {
                const cleanPlate = newOrder.plate.replace(/\s+/g, '');
                const trackingUrl = `https://ototakip.com/takip/${cleanPlate}`;
                const workshopName = req.session.workshopName || 'Merkez Oto Servis';

                const welcomeMessage = 
                    `🚗 *${workshopName.toUpperCase()} - Servisimize Hoş Geldiniz!*\n\n` +
                    `Sayın *${newOrder.customer_name || 'Müşterimiz'}*,\n` +
                    `*${newOrder.plate}* plakalı (${newOrder.car_model}) aracınızın servis kabul işlemleri başarıyla tamamlanmıştır.\n\n` +
                    `🔧 *Şeffaf Servis Sürecimiz:*\n` +
                    `Servisimizde aracınızın tüm bakım, arıza tespiti ve parça onay aşamaları bu WhatsApp hattı ve canlı takip panelimiz üzerinden yönetilmektedir.\n\n` +
                    `• 🔍 *Canlı Takip:* Aracınızın anlık aşamalarını (Teşhis, Parça, Onarım, Test, Hazır) aşağıdaki linkten 7/24 izleyebilirsiniz.\n` +
                    `• 🛠️ *Dijital Onay:* Değişecek parçalar ve fiyatlar onayınıza buradan sunulacaktır (Onayınız olmadan işlem yapılmaz).\n` +
                    `• 📸 *Fotoğraflı Kanıt:* Hasarlı ve değişen parçaların fotoğrafları panelinize yüklenecektir.\n\n` +
                    (newOrder.estimated_delivery ? `⏱️ *Hedef Teslim Zamanı:* ${newOrder.estimated_delivery}\n\n` : '') +
                    `🔗 *Canlı Araç Takip Linkiniz:*\n${trackingUrl}\n\n` +
                    `Aklınıza takılan her türlü konuyu bu mesaja doğrudan yanıt yazarak ustanıza iletebilirsiniz. Bizi tercih ettiğiniz için teşekkür ederiz! 🚗✨`;

                await sendTextMessage(newOrder.customer_phone, welcomeMessage);
            } catch (waErr) {
                console.warn('[WhatsApp] Hoş geldiniz karşılama mesajı iletilemedi:', waErr.message);
            }
        }

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
    const { part_name, note, price } = req.body;
    const workshopId = req.session.workshopId;

    try {
        if (!part_name) {
            throw new Error('Parça adı zorunludur.');
        }

        // 1. Aracı ve müşteri telefonunu veritabanından çek
        const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);

        // 2. Onay talebini SQLite'a PENDING olarak kaydet
        const newApproval = workshopService.createApprovalRequest(workOrderId, part_name, note, price);

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

/**
 * 7. Araca Servis/Ekspertiz Fotoğrafı Yükle - POST /arac/:id/foto-yukle
 */
async function uploadVehiclePhoto(req, res) {
    const workOrderId = req.params.id;
    const { caption, send_whatsapp } = req.body;
    const workshopId = req.session.workshopId;

    try {
        if (!req.file) {
            throw new Error('Lütfen yüklenecek bir fotoğraf seçiniz.');
        }

        const relativePhotoPath = `/uploads/${req.file.filename}`;
        const absolutePhotoPath = req.file.path;

        // 1. Veritabanına kaydet
        workshopService.addServicePhoto(workOrderId, relativePhotoPath, caption);

        // 2. Müşteriye WhatsApp görseli olarak gönder (Seçildiyse)
        if (send_whatsapp === 'on' || send_whatsapp === '1') {
            try {
                const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);
                if (car && car.customer_phone) {
                    const trackingUrl = `https://ototakip.com/takip/${car.plate.replace(/\s+/g, '')}`;
                    const captionText = 
                        `📸 *Araç İnceleme & Parça Fotoğrafı*\n\n` +
                        `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
                        `*${car.plate}* plakalı aracınızın servis kontrolünde çekilen parça görseli ekte bilgilerinize sunulmuştur:\n\n` +
                        `🔍 *Açıklama:* ${caption ? caption.trim() : 'Hasarlı/Aşınmış parça kanıtı'}\n\n` +
                        `🔗 Detaylı Canlı Takip: ${trackingUrl}`;

                    await sendImageMessage(car.customer_phone, absolutePhotoPath, captionText);
                }
            } catch (waErr) {
                console.warn('[WhatsApp] Fotoğraf iletilemedi:', waErr.message);
            }
        }

        res.redirect(`/arac/${workOrderId}?photoUploaded=1`);
    } catch (err) {
        console.error('Fotoğraf yükleme hatası:', err.message);
        res.redirect(`/arac/${workOrderId}?error=${encodeURIComponent(err.message)}`);
    }
}

/**
 * 8. Dijital Servis Fişi / Hesap Özeti Kaydet & WhatsApp Gönder - POST /arac/:id/servis-fisi
 */
async function createServiceReceipt(req, res) {
    const workOrderId = req.params.id;
    const { labor_cost, item_name, item_price, notes, send_whatsapp } = req.body;
    const workshopId = req.session.workshopId;

    try {
        const car = workshopService.getWorkOrderDetail(workOrderId, workshopId);

        // Kalem dizilerini normalize et
        const names = Array.isArray(item_name) ? item_name : (item_name ? [item_name] : []);
        const prices = Array.isArray(item_price) ? item_price : (item_price ? [item_price] : []);

        const items = [];
        for (let i = 0; i < names.length; i++) {
            const name = (names[i] || '').trim();
            const price = Number(prices[i]) || 0;
            if (name) {
                items.push({ name, price });
            }
        }

        // 1. Veritabanına kaydet
        const receipt = workshopService.saveServiceReceipt(workOrderId, {
            labor_cost: Number(labor_cost) || 0,
            items,
            notes
        });

        // 2. WhatsApp ile Müşteriye Gönder (Seçiliyse)
        if (send_whatsapp === 'on' || send_whatsapp === '1') {
            try {
                const workshopName = req.session.workshopName || 'Merkez Oto Servis';
                await sendServiceReceiptMessage(car.customer_phone, car, receipt, workshopName);
            } catch (waErr) {
                console.warn('[WhatsApp] Servis fişi iletilemedi:', waErr.message);
            }
        }

        // 3. SSE ile canlı yayına bildir
        sseService.broadcast('RECEIPT_SAVED', {
            workOrderId: Number(workOrderId),
            totalAmount: receipt.total_amount
        });

        res.redirect(`/arac/${workOrderId}?receiptSaved=1`);
    } catch (err) {
        console.error('Servis fişi oluşturma hatası:', err.message);
        res.redirect(`/arac/${workOrderId}?error=${encodeURIComponent(err.message)}`);
    }
}

/**
 * 9. Servis Arşivi (Teslim Edilmiş Araçlar & AJAX Arama) - GET /arsiv
 */
function showArchive(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const searchQuery = req.query.q || '';
        const archivedCars = workshopService.getArchiveData(workshopId, searchQuery);

        const totalDelivered = archivedCars.length;
        const totalRevenue = archivedCars.reduce((sum, car) => sum + (Number(car.invoice_amount) || 0), 0);

        // AJAX isteği ise JSON döndür (hızlı anlık filtreleme için)
        if (req.query.ajax === '1' || req.xhr || req.headers.accept?.includes('application/json')) {
            return res.json({
                success: true,
                archivedCars,
                totalDelivered,
                totalRevenue,
                searchQuery
            });
        }

        res.render('dashboard/archive', {
            title: 'Servis Arşivi & Geçmiş Kayıtlar',
            archivedCars,
            searchQuery,
            totalDelivered,
            totalRevenue,
            error: null
        });
    } catch (err) {
        console.error('Arşiv yükleme hatası:', err);
        if (req.query.ajax === '1' || req.xhr) {
            return res.status(500).json({ success: false, message: 'Arşiv verileri yüklenemedi.' });
        }
        res.redirect('/dashboard');
    }
}

module.exports = {
    showDashboard,
    showVehicleDetail,
    updateStage,
    createWorkOrder,
    sendApprovalRequest,
    replyToCustomer,
    uploadVehiclePhoto,
    createServiceReceipt,
    showArchive
};
