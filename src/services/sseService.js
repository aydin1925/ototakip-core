// sseService.js - Tarayıcıya anlık bildirim fırlatan Server-Sent Events servisi
/**
 * sseService.js
 * Tarayıcıya canlı (real-time) bildirim akışı sağlayan Server-Sent Events servisi.
 */

// Sisteme bağlı olan tüm aktif tarayıcı sekmelerini tuttuğumuz küme (Set)
const clients = new Set();

/**
 * 1. Yeni Bir Tarayıcıyı Canlı Yayına Bağlama
 * Usta dashboard'u açtığında tarayıcısı bu fonksiyona bağlanır.
 */
function addClient(req, res) {
    // SSE için zorunlu HTTP başlıkları (Headers)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream', // Tarayıcıya "bu bir SSE akışıdır" der
        'Cache-Control': 'no-cache',         // Araya hiçbir proxy/önbellek girmesin
        'Connection': 'keep-alive'           // Bağlantıyı asla kapatma, sürekli açık tut
    });

    // İlk el sıkışma: Bağlantının canlı olduğunu doğrula
    res.write('data: {"type":"CONNECTED"}\n\n');

    // Bu bağlantıyı aktif dinleyiciler listemize ekle
    clients.add(res);

    // Usta sekmeyi kapattığında veya sayfadan ayrıldığında hafıza sızıntısını önlemek için listeden çıkar
    req.on('close', () => {
        clients.delete(res);
    });
}

/**
 * 2. Tüm Bağlı Ekranlara Canlı Sinyal Gönderme (Broadcast)
 * WhatsApp botu bir onay aldığında veya usta aşama değiştirdiğinde bu fonksiyon çağrılır.
 */
function broadcast(eventType, payload = {}) {
    const message = JSON.stringify({ type: eventType, data: payload });
    
    // SSE format kuralı: Her mesaj 'data: ... \n\n' şeklinde iki yeni satırla bitmelidir
    const formattedData = `data: ${message}\n\n`;

    for (const client of clients) {
        client.write(formattedData);
    }
}

module.exports = {
    addClient,
    broadcast
};