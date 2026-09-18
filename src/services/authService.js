// authService.js - Kimlik doğrulama, şifreleme ve oturum iş mantığı
const crypto = require('node:crypto');
const { db } = require('../infrastructure/database/db');

// Şifre hashleme
function hashPassword(password) {
    // 16 byte'lık rastgele bir salt üret
    const salt = crypto.randomBytes(16).toString('hex');
    // Scrypt algoritması ile 64 bytelık kriptografik özet çıkar
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    // veritabanına yaz
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, originalHash] = storedHash.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');

    // crypto.timingSafeEqual: Karşılaştırma süresinden şifre tahminini önle
    return crypto.timingSafeEqual(
        Buffer.from(originalHash, 'hex'),
        Buffer.from(hash, 'hex'),
    );
}

// Telefon numarasını istediğimiz formata getir
function sanitizePhone(rawPhone) {
    let clean = String(rawPhone || '').replace(/\D/g, ''); // Sadece rakamları al
    if (clean.startsWith('0')) clean = '90' + clean.slice(1);
    else if (clean.length === 10 && clean.startsWith('5')) clean = '90' + clean;
    return clean;
}

// Yeni Oto servis kaydı
function register({workshop_name, owner_name, phone, email, password}) {
    if(!workshop_name || !owner_name || !phone || !password) {
        throw new Error('Lütfen zorunlu alanları (Atölye Adı, Usta Adı, Telefon, Şifre) doldurunuz.');
    }

    if(password.length < 6) {
        throw new Error('Şifreniz en az 6 karakter olmalıdır.');
    }

    const cleanPhone = sanitizePhone(phone);

    const existing = db.prepare('SELECT id FROM workshops WHERE phone = ?').get(cleanPhone);
    if(existing) {
        throw new Error('Bu telefon numarasıyla kayıtlı bir atölye zaten mevcut.');

    }

    // şifreyi hashle
    const password_hash = hashPassword(password);

    const stmt = db.prepare('INSERT INTO workshops (workshop_name, owner_name, phone, email, password_hash) VALUES (?, ?, ?, ?, ?)');

    const result = stmt.run(
        workshop_name.trim(),
        owner_name.trim(),
        cleanPhone,
        email ? email.trim() : null,
        password_hash
    );

    return {
        id: Number(result.lastInsertRowid),
        workshop_name: workshop_name.trim(),
        owner_name: owner_name.trim(),
        phone: cleanPhone,
        email: email ? email.trim() : null
    }
}

// Giriş
function login(identifier, password) {
    if (!identifier || !password) {
        throw new Error('Lütfen telefon/e-posta ve şifrenizi giriniz.');
    }

    const cleanPhone = sanitizePhone(identifier);

    const workshop = db.prepare(`
        SELECT * FROM workshops 
        WHERE (phone != '' AND phone = ?) 
           OR (email IS NOT NULL AND LOWER(email) = LOWER(?))
           OR LOWER(owner_name) = LOWER(?)
    `).get(cleanPhone, identifier.trim(), identifier.trim());

      if (!workshop) {
        throw new Error('Bu telefon veya e-posta ile kayıtlı bir atölye bulunamadı.');
    }

    // Şifreyi doğrula
    const isMatch = verifyPassword(password, workshop.password_hash);
    if (!isMatch) {
        throw new Error('Hatalı şifre girdiniz.');
    }

    // Güvenlik için hash'i session'a aktarmadan temizle
    const { password_hash, ...safeWorkshop } = workshop;
    return safeWorkshop;
}

module.exports = {hashPassword, verifyPassword, sanitizePhone, register, login};