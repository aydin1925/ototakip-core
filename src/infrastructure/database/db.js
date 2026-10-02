const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Veritabanı dosyası projenin ana klasöründe olacak
const dbPath = path.resolve(__dirname, '../../../ototakip.db');
const schemaPath = path.resolve(__dirname, 'schema.sql');

// SQLite bağlantısını başlat
const db = new DatabaseSync(dbPath);

// Performans ve güvenlik ayarları
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Tabloları oluşturan fonksiyon
function initDatabase() {
    // 1. Gerekli upload klasörlerini garanti et
    const uploadsDir = path.resolve(__dirname, '../../public/uploads');
    const logosDir = path.resolve(__dirname, '../../public/uploads/logos');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

    // 2. workshops tablosu için migration kontrolleri (Önce kolonları garanti et)
    try {
        // Eğer tablo varsa eksik kolonları ekle
        const checkTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workshops'").get();
        if (checkTable) {
            const columns = db.prepare("PRAGMA table_info(workshops)").all();
            const colNames = columns.map(c => c.name);

            const columnsToAdd = [
                { name: 'capacity', def: 'INTEGER DEFAULT 3' },
                { name: 'city', def: 'TEXT' },
                { name: 'district', def: 'TEXT' },
                { name: 'address', def: 'TEXT' },
                { name: 'maps_link', def: 'TEXT' },
                { name: 'landline_phone', def: 'TEXT' },
                { name: 'tax_office', def: 'TEXT' },
                { name: 'tax_number', def: 'TEXT' },
                { name: 'service_type', def: "TEXT DEFAULT 'private'" },
                { name: 'opening_time', def: "TEXT DEFAULT '08:30'" },
                { name: 'closing_time', def: "TEXT DEFAULT '18:30'" },
                { name: 'working_days', def: "TEXT DEFAULT 'pzt,sal,car,per,cum'" },
                { name: 'logo_url', def: 'TEXT' },
                { name: 'google_review_url', def: 'TEXT' },
                { name: 'instagram_username', def: 'TEXT' },
                { name: 'website_url', def: 'TEXT' },
                { name: 'is_active', def: 'INTEGER DEFAULT 1' }
            ];

            for (const col of columnsToAdd) {
                if (!colNames.includes(col.name)) {
                    db.exec(`ALTER TABLE workshops ADD COLUMN ${col.name} ${col.def};`);
                }
            }
        }
    } catch (e) {
        console.error('workshops migration hatası:', e.message);
    }

    // 3. Şema dosyasını çalıştır (Tüm tablolar ve indeksler oluşturulur)
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);

    // 4. work_orders tablosunda workshop_id kontrolü
    try {
        const columns = db.prepare("PRAGMA table_info(work_orders)").all();
        if (!columns.some(col => col.name === 'workshop_id')) {
            db.exec("ALTER TABLE work_orders ADD COLUMN workshop_id INTEGER DEFAULT 1;");
        }
    } catch (e) {
        // Pas geç
    }

    // 5. approval_requests tablosunda price kolonu kontrolü
    try {
        const approvalCols = db.prepare("PRAGMA table_info(approval_requests)").all();
        if (!approvalCols.some(col => col.name === 'price')) {
            db.exec("ALTER TABLE approval_requests ADD COLUMN price REAL DEFAULT 0;");
        }
    } catch (e) {
        // Pas geç
    }

    // 6. superadmins tablosu kontrolü ve varsayılan yönetici tohumu (seed)
    try {
        const adminCount = db.prepare("SELECT COUNT(*) as count FROM superadmins").get();
        if (adminCount.count === 0) {
            // Varsayılan ilk SüperAdmin: admin / admin123
            const crypto = require('node:crypto');
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
            const password_hash = `${salt}:${hash}`;
            
            db.prepare(`
                INSERT INTO superadmins (username, email, password_hash)
                VALUES (?, ?, ?)
            `).run('admin', 'admin@ototakip.com', password_hash);
            console.log('✓ Varsayılan SüperAdmin hesabı oluşturuldu (Kullanıcı: admin / Şifre: admin123)');
        }
    } catch (e) {
        console.error('superadmins seed hatası:', e.message);
    }

    console.log('✓ SQLite veritabanı ve tablolar başarıyla hazırlandı: ototakip.db');
}

module.exports = {
    db,
    initDatabase
};