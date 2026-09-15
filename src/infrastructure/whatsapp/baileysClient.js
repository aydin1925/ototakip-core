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

// Aktif soket referansını modül seviyesinde tutuyoruz
let currentSocket = null;

// Eşleştirme yapılacak telefon numaranız
const PAIRING_PHONE_NUMBER = '905377463310'; 

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

function getSocket() {
    return currentSocket;
}

module.exports = {
    connectToWhatsApp,
    sendTextMessage,
    sendImageMessage,
    formatToWhatsappJid,
    getSocket
};