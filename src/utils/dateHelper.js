/**
 * Türkiye Saat Dilimi (Europe/Istanbul - UTC+3) Tarih ve Saat Formatlama Yardımcısı
 * SQLite veritabanındaki UTC zaman damgalarını Türkiye yerel saatine dönüştürür.
 */

/**
 * UTC / ISO tarih metnini Türkiye yerel saatine (GMT+3) çevirir ve formatlar
 * @param {string|Date|number} dateInput 
 * @returns {{ formatted: string, date: string, time: string, relative: string, iso: string }}
 */
function formatToTurkeyTime(dateInput) {
    if (!dateInput) {
        return { formatted: '-', date: '-', time: '-', relative: '-', iso: '' };
    }

    let date;
    if (dateInput instanceof Date) {
        date = dateInput;
    } else if (typeof dateInput === 'string') {
        const trimmed = dateInput.trim();
        // SQLite CURRENT_TIMESTAMP formatı: "YYYY-MM-DD HH:MM:SS" (UTC)
        if (trimmed.includes(' ') && !trimmed.includes('T')) {
            date = new Date(trimmed.replace(' ', 'T') + 'Z');
        } else if (!trimmed.endsWith('Z') && !trimmed.includes('+')) {
            date = new Date(trimmed + 'Z');
        } else {
            date = new Date(trimmed);
        }
    } else {
        date = new Date(dateInput);
    }

    if (isNaN(date.getTime())) {
        return { formatted: String(dateInput), date: '', time: '', relative: '-', iso: '' };
    }

    // Türkiye kalıcı olarak UTC+3 dilimindedir (Europe/Istanbul)
    const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const timeFormatter = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const dateStr = dateFormatter.format(date); // "02.10.2026"
    const timeStr = timeFormatter.format(date); // "11:53:37"
    const formatted = `${dateStr} ${timeStr}`;

    // Göreli zaman (relative time) hesaplama
    const now = new Date();
    const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
    let relative = '';

    if (diffSec < 45) {
        relative = 'Az önce';
    } else if (diffSec < 3600) {
        const mins = Math.floor(diffSec / 60);
        relative = `${mins} dk önce`;
    } else if (diffSec < 86400) {
        const hours = Math.floor(diffSec / 3600);
        relative = `${hours} saat önce`;
    } else if (diffSec < 86400 * 30) {
        const days = Math.floor(diffSec / 86400);
        relative = `${days} gün önce`;
    } else {
        relative = dateStr;
    }

    return {
        formatted,
        date: dateStr,
        time: timeStr,
        relative,
        iso: date.toISOString()
    };
}

module.exports = {
    formatToTurkeyTime
};
