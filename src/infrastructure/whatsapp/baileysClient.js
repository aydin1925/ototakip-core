const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const { db } = require('../database/db.js');
const sseService = require('../../services/sseService.js');

// Aktif soket referansını modül seviyesinde tutuyoruz
let currentSocket = null;

// Eşleştirme yapılacak telefon numaranız (.env dosyasından okunur)
const PAIRING_PHONE_NUMBER = process.env.TEST_PHONE_NUMBER || ''; 

/**
 * Telefon numarasını WhatsApp JID formatına dönüştürür.
 */
function formatToWhatsappJid(phone) {
    if (!phone) return null;
    let cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
    }
    if (cleaned.length === 10) {
        cleaned = '90' + cleaned;
    }
    return `${cleaned}@s.whatsapp.net`;
}

/**
 * WhatsApp Web soket bağlantısını başlatır ve yönetir.
 */
async function connectToWhatsApp() {
    const authPath = path.resolve(__dirname, '../../../auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }), // Log kirliliğini engelle
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome') // WhatsApp'ın en stabil kabul ettiği kimlik
    });

    currentSocket = sock;

    // Şifreleme anahtarları güncellendikçe diske yaz
    sock.ev.on('creds.update', saveCreds);

    // Bağlantı durum değişikliklerini dinle
    let pairingCodeRequested = false;
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // WhatsApp sunucusu kimlik doğrulamaya hazır olduğunda Eşleştirme Kodunu anında iste
        if (qr && !sock.authState.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true;
            try {
                const code = await sock.requestPairingCode(PAIRING_PHONE_NUMBER);
                console.log('\n==================================================');
                console.log(`📱 WHATSAPP EŞLEŞTİRME KODUNUZ:  ${code}`);
                console.log('Telefonunuzdan: WhatsApp > Ayarlar > Bağlı Cihazlar');
                console.log('> Cihaz Bağla > "Telefon numarasıyla bağla" seçeneğine');
                console.log('bu kodu girin.');
                console.log('==================================================\n');
            } catch (err) {
                console.error('[WhatsApp] Eşleştirme kodu alınamadı:', err.message);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`\n[WhatsApp] Bağlantı kapandı (Durum Kodu: ${statusCode || 'Bilinmiyor'}).`);

            if (shouldReconnect) {
                console.log('[WhatsApp] 10 saniye içinde yeniden bağlanılıyor...');
                setTimeout(() => {
                    connectToWhatsApp();
                }, 10000);
            } else {
                console.log('[WhatsApp] Oturum sonlandırıldı (Logged out).');
            }
        } else if (connection === 'open') {
            console.log('\n✓ [WhatsApp] Bağlantı başarıyla kuruldu ve sistem hazır!\n');

            const testMesaji = 
                `🚗 *OtoTakip Servis Bilgilendirmesi*\n\n` +
                `Sayın *Mehmet Yılmaz*,\n` +
                `*33 BCD 128* plakalı Dacia Sandero Stepway aracınız servisimize kabul edilmiştir.\n\n` +
                `🔧 *Müşteri Şikayeti:* Ön takımdan lokurtu sesi geliyor, periyodik bakım\n` +
                `📍 *İstasyon:* Lift 3\n` +
                `⏱️ *Tahmini Teslim:* 18.09.2026 17:30\n\n` +
                `⚠️ *Onay Bekleyen Parça:* Ön Salıncak Burcu (1.850 TL)\n` +
                `Değişimi onaylamak için *1*, reddetmek için *2* yazabilirsiniz.\n` +
                `Dilerseniz doğrudan ustanıza iletmek istediğiniz bir soruyu da yazabilirsiniz.\n\n` +
                `🔗 *Canlı Takip Ekranı:* https://ototakip.com/takip/33BCD128`;
            
            try {
                await sendTextMessage(PAIRING_PHONE_NUMBER, testMesaji);
                console.log(`📨 Canlı test mesajı telefonunuza (${PAIRING_PHONE_NUMBER}) gönderildi! WhatsApp'ınızı kontrol edin.\n`);
            } catch (err) {
                console.error('[WhatsApp] Mesaj gönderilemedi:', err.message);
            }
        }
    });

    // Gelen WhatsApp mesajlarını dinle ve akıllıca yanıtla
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            const incomingText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (!incomingText) continue;

            // Botun kendi gönderdiği mesajları atla (sonsuz döngü koruması)
            if (
                incomingText.startsWith('🚗 *OtoTakip') ||
                incomingText.startsWith('✓ *Onayınız') ||
                incomingText.startsWith('ℹ *İptal') ||
                incomingText.startsWith('Mesajınız ustanıza')
            ) {
                continue;
            }

            const senderPhone = msg.key.remoteJid;
            if (!senderPhone) continue;

            // 1. WhatsApp Grupları, Yayın Listeleri ve Durum Güncellemelerini tamamen yoksay
            if (
                senderPhone.endsWith('@g.us') || 
                senderPhone.endsWith('@broadcast') || 
                senderPhone.endsWith('@newsletter') ||
                senderPhone === 'status@broadcast'
            ) {
                continue;
            }

            // 2. Kendi attığımız dış mesajları yoksay (Sadece kendine not / test amaçlı kendi numaramıza yazıyorsak izin ver)
            if (msg.key.fromMe) {
                const isSelfTest = PAIRING_PHONE_NUMBER && (senderPhone.includes(PAIRING_PHONE_NUMBER) || senderPhone.endsWith('@lid'));
                if (!isSelfTest) {
                    continue; // Kendi telefonumuzdan başka bir arkadaşımıza yazarken bot araya girmesin
                }
            }

            const cleanText = incomingText.trim().toLowerCase();
            
            // Telefon numarasını temizle
            let cleanPhone = senderPhone.split('@')[0].split(':')[0].replace(/\D/g, '');
            
            // Eğer WhatsApp'ın gizli cihaz kimliği (@lid) ise veya test numaramızsa
            if (senderPhone.endsWith('@lid')) {
                if (msg.key.fromMe || (PAIRING_PHONE_NUMBER && senderPhone.includes(PAIRING_PHONE_NUMBER))) {
                    cleanPhone = PAIRING_PHONE_NUMBER;
                } else {
                    // Tanımlanamayan @lid kimliği (kişisel sohbet gizlilik id'si) -> İşleme alma
                    continue;
                }
            }

            // 3. Veritabanından bu müşterinin aktif iş emrini bul (Son 10 hane esnekliğiyle)
            const last10Digits = cleanPhone.slice(-10);
            const workOrder = db.prepare(`
                SELECT * FROM work_orders 
                WHERE (customer_phone = ? OR customer_phone LIKE ?) 
                  AND status != 'DELIVERED'
                ORDER BY id DESC LIMIT 1
            `).get(cleanPhone, `%${last10Digits}`);

            // 4. KRİTİK GÜVENLİK DUVARI:
            // Eğer bu numaranın sistemde aktif bir araç/tamir kaydı yoksa,
            // bu kişi kişisel bir tanıdıktır (arkadaş, aile vb.).
            // KESİNLİKLE HİÇBİR CEVAP GÖNDERME VE MESAJI YOK SAY!
            if (!workOrder) {
                continue;
            }

            // Bu aşamaya ulaşıldıysa mesaj kesinlikle servisteki bir müşteriden gelmiştir!
            console.log(`\n📩 [Müşteri WhatsApp Mesajı] Araç: ${workOrder.plate} (${workOrder.customer_name})`);
            console.log(`   İçerik: "${incomingText}"`);
            console.log(`   Numara: ${cleanPhone}`);

            const activeRequest = db.prepare('SELECT * FROM approval_requests WHERE work_order_id = ? ORDER BY id DESC LIMIT 1').get(workOrder.id);
            console.log(`   Mevcut Talep: ${activeRequest ? activeRequest.part_name + ' (' + activeRequest.status + ')' : 'YOK'}`);

            // 1. Onay Durumu ("onaylıyorum", "kabul ediyorum", "onay", "kabul", "1")
            if (['onaylıyorum', 'kabul ediyorum', 'onay', 'kabul', 'tamamdır', '1'].includes(cleanText)) {
                if (activeRequest && activeRequest.status === 'PENDING') {
                    // Durumu APPROVED yap ve zamanı kaydet
                    db.prepare("UPDATE approval_requests SET status = 'APPROVED', responded_at = datetime('now', 'localtime') WHERE id = ?").run(activeRequest.id);
                    console.log(`   ➔ [Veritabanı Güncellendi] ${workOrder.plate} - ${activeRequest.part_name}: APPROVED ✓`);

                    // Canlı SSE yayını: Ustanın tarayıcısını anında yeşile çevir
                    try {
                        sseService.broadcast('APPROVAL_CONFIRMED', {
                            workOrderId: workOrder.id,
                            plate: workOrder.plate,
                            partName: activeRequest.part_name
                        });
                    } catch (e) {
                        // sessiz geç
                    }

                    await sock.sendMessage(senderPhone, {
                        text: `✓ *Onayınız Sisteme İşlendi!*\n\nSayın *${workOrder.customer_name}*, *${activeRequest.part_name}* değişimi onayınız alındı. Ustanız parça montajına başladı.\n\n🔗 Canlı Takip: https://ototakip.com/takip/${workOrder.plate.replace(/\s+/g, '')}`
                    });
                } else if (activeRequest && activeRequest.status === 'APPROVED') {
                    console.log(`   ℹ [Kilitli] ${workOrder.plate} - Talep zaten daha önce onaylanmış.`);
                    await sock.sendMessage(senderPhone, {
                        text: `ℹ Sayın *${workOrder.customer_name}*, *${activeRequest.part_name}* değişimi daha önce onaylanmış ve montaj aşamasına geçilmiştir.\n\nİptal veya ek talepleriniz için lütfen ustanızı arayınız.`
                    });
                } else if (activeRequest && activeRequest.status === 'REJECTED') {
                    console.log(`   ℹ [Kilitli] ${workOrder.plate} - Talep daha önce reddedilmişti.`);
                    await sock.sendMessage(senderPhone, {
                        text: `ℹ Sayın *${workOrder.customer_name}*, *${activeRequest.part_name}* talebi daha önce iptal edilmiştir. Tekrar işleme alınması için lütfen ustanızla görüşün.`
                    });
                } else {
                    await sock.sendMessage(senderPhone, {
                        text: `Sayın *${workOrder.customer_name}*, şu anda onay bekleyen aktif bir parça talebiniz bulunmamaktadır.`
                    });
                }
            }
            // 2. Red Durumu ("reddediyorum", "kabul etmiyorum", "red", "iptal", "2")
            else if (['reddediyorum', 'kabul etmiyorum', 'red', 'istemiyorum', 'iptal', '2'].includes(cleanText)) {
                if (activeRequest && activeRequest.status === 'PENDING') {
                    // Durumu REJECTED yap
                    db.prepare("UPDATE approval_requests SET status = 'REJECTED', responded_at = datetime('now', 'localtime') WHERE id = ?").run(activeRequest.id);
                    console.log(`   ➔ [Veritabanı Güncellendi] ${workOrder.plate} - ${activeRequest.part_name}: REJECTED ✗`);

                    // Canlı SSE yayını: Ustanın ekranına iptal bilgisini bildir
                    try {
                        sseService.broadcast('APPROVAL_REJECTED', {
                            workOrderId: workOrder.id,
                            plate: workOrder.plate,
                            partName: activeRequest.part_name
                        });
                    } catch (e) {
                        // sessiz geç
                    }

                    await sock.sendMessage(senderPhone, {
                        text: `ℹ *İptal Edildi.*\n\nSayın *${workOrder.customer_name}*, *${activeRequest.part_name}* değişim talebiniz reddedildi olarak kaydedildi. Parça takılmayacaktır.`
                    });
                } else if (activeRequest && activeRequest.status === 'APPROVED') {
                    // Müşteri önce onaylamış, şimdi red etmeye çalışıyor -> KİLİT!
                    console.log(`   ⚠️ [Kilit Engeli] Müşteri onaylanmış parçayı iptal etmek istedi: ${workOrder.plate}`);
                    await sock.sendMessage(senderPhone, {
                        text: `⚠️ *İşlem Kilitli!*\n\nSayın *${workOrder.customer_name}*, *${activeRequest.part_name}* değişimi için onayınız daha önce alınmış ve ustanız montaja başlamıştır.\n\nParça söküm/iptal işlemleri için lütfen doğrudan servisimizi arayınız: 📞 0532 000 00 00`
                    });
                } else if (activeRequest && activeRequest.status === 'REJECTED') {
                    await sock.sendMessage(senderPhone, {
                        text: `ℹ Sayın *${workOrder.customer_name}*, bu talep zaten daha önce iptal edilmişti.`
                    });
                } else {
                    await sock.sendMessage(senderPhone, {
                        text: `Sayın *${workOrder.customer_name}*, şu anda reddedilecek aktif bir parça talebiniz bulunmamaktadır.`
                    });
                }
            }
            // 3. Serbest Soru / Müşteri Özel Talebi
            else {
                console.log(`\n🔔 [USTA BİLDİRİMİ GEREKLİ] Müşteri (${workOrder.customer_name} - ${workOrder.plate}) sordu: "${incomingText}"`);
                console.log(`   İletişim Numarası: ${senderPhone}`);

                // Gelen soruyu veritabanına kalıcı olarak kaydet
                try {
                    db.prepare(`
                        INSERT INTO customer_messages (work_order_id, sender_type, message_text)
                        VALUES (?, 'CUSTOMER', ?)
                    `).run(workOrder.id, incomingText.trim());
                } catch (dbErr) {
                    console.error('Mesaj veritabanına kaydedilemedi:', dbErr.message);
                }

                // Canlı SSE yayını: Ustanın ekranına soru bildirimini fırlat
                try {
                    sseService.broadcast('CUSTOMER_QUESTION', {
                        workOrderId: workOrder.id,
                        plate: workOrder.plate,
                        customerName: workOrder.customer_name,
                        text: incomingText
                    });
                } catch (e) {
                    // sessiz geç
                }

                await sock.sendMessage(senderPhone, {
                    text: `Sayın *${workOrder.customer_name}*, mesajınız ustanıza iletildi. En kısa sürede ustanız kontrol edip size bilgi verecektir. 👨‍🔧`
                });
            }
        }
    });

    return sock;
}

/**
 * Belirtilen numaraya metin mesajı gönderir.
 */
async function sendTextMessage(phone, text) {
    if (!currentSocket) {
        throw new Error('WhatsApp istemcisi henüz hazır değil! Lütfen bağlantıyı bekleyin.');
    }
    const jid = formatToWhatsappJid(phone);
    return await currentSocket.sendMessage(jid, { text });
}

/**
 * Belirtilen numaraya fotoğraf ve açıklama gönderir.
 */
async function sendImageMessage(phone, imagePathOrBuffer, caption = '') {
    if (!currentSocket) {
        throw new Error('WhatsApp istemcisi henüz hazır değil! Lütfen bağlantıyı bekleyin.');
    }
    const jid = formatToWhatsappJid(phone);
    
    let buffer;
    if (Buffer.isBuffer(imagePathOrBuffer)) {
        buffer = imagePathOrBuffer;
    } else {
        buffer = fs.readFileSync(imagePathOrBuffer);
    }

    return await currentSocket.sendMessage(jid, {
        image: buffer,
        caption: caption
    });
}

/**
 * Usta web masasından parça onay talebi gönderdiğinde müşteriye resmi WhatsApp mesajı atar.
 */
async function sendApprovalRequestMessage(customerPhone, car, part) {
    if (!currentSocket) {
        throw new Error('WhatsApp servisi şu an bağlı değil. Lütfen bağlantıyı kontrol edin.');
    }

    const jid = formatToWhatsappJid(customerPhone);
    if (!jid) {
        throw new Error('Geçersiz müşteri telefon numarası.');
    }

    const trackingUrl = `http://localhost:3000/takip/${car.plate.replace(/\s+/g, '')}`;

    const text = 
        `🚗 *OtoTakip Bilgilendirme*\n\n` +
        `Sayın *${car.customer_name || 'Müşterimiz'}*,\n` +
        `*${car.plate}* plakalı (*${car.car_model}*) aracınızın kontrolleri sırasında ustanız parça değişimi için onayınızı talep etmektedir:\n\n` +
        `🔧 *Değişecek Parça:* ${part.part_name}\n` +
        `💰 *Fiyat / Açıklama:* ${part.note || 'Belirtilmedi'}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ Parça değişimini onaylamak için bu mesaja:\n` +
        `👉 *ONAYLIYORUM* (veya *KABUL EDİYORUM*)\n\n` +
        `❌ Talebi iptal etmek için:\n` +
        `👉 *REDDEDİYORUM*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔗 *Canlı Araç Takibi:* ${trackingUrl}`;

    return await currentSocket.sendMessage(jid, { text });
}

function getSocket() {
    return currentSocket;
}

module.exports = {
    connectToWhatsApp,
    sendTextMessage,
    sendImageMessage,
    sendApprovalRequestMessage,
    formatToWhatsappJid,
    getSocket
};