/**
 * live-stream.js
 * Tarayıcı tarafında çalışan Server-Sent Events (SSE) dinleyicisi.
 * Sayfayı yenilemeden (F5 yapmadan) WhatsApp onaylarını ve canlı olayları yakalar.
 */
(function initLiveStream() {
    if (!window.EventSource) {
        console.warn('Tarayıcınız SSE (Server-Sent Events) canlı akışını desteklemiyor.');
        return;
    }

    const evtSource = new EventSource('/api/events');

    evtSource.onmessage = function(event) {
        try {
            const payload = JSON.parse(event.data);
            
            // 1. İlk bağlantı teyidi
            if (payload.type === 'CONNECTED') {
                console.log('✓ OtoTakip canlı bildirim akışına başarıyla bağlandı.');
                return;
            }

            // 2. Müşteri WhatsApp'tan Parça Onayı Verdiğinde
            if (payload.type === 'APPROVAL_CONFIRMED' || payload.type === 'PARCA_ONAYLANDI') {
                if (window.toast) {
                    window.toast('🔔 Müşteri WhatsApp üzerinden parçayı ONAYLADI!', 'success');
                }
                // Usta lift ekranındaysa veya araç detayındaysa içeriği güncelle
                setTimeout(() => window.location.reload(), 1500);
            }

            // 3. Aracın Aşaması Değiştiğinde
            if (payload.type === 'STAGE_CHANGED') {
                if (window.toast) {
                    window.toast('Araç tamir aşaması güncellendi.', 'info');
                }
            }

            // 4. Yeni Araç Kabul Edildiğinde
            if (payload.type === 'NEW_VEHICLE') {
                if (window.toast) {
                    window.toast(`Yeni araç lifte alındı: ${payload.data ? payload.data.plate : ''}`, 'info');
                }
            }
        } catch (e) {
            console.error('SSE mesaj ayrıştırma hatası:', e);
        }
    };

    evtSource.onerror = function() {
        console.warn('Canlı bildirim akışı kesildi, otomatik yeniden bağlanılıyor...');
    };
})();
