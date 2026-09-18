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
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);

    // Mevcut veritabanı için migration: work_orders tablosunda workshop_id yoksa ekle
    try {
        const columns = db.prepare("PRAGMA table_info(work_orders)").all();
        if (!columns.some(col => col.name === 'workshop_id')) {
            db.exec("ALTER TABLE work_orders ADD COLUMN workshop_id INTEGER DEFAULT 1;");
        }
    } catch (e) {
        // Pas geç
    }

    console.log('✓ SQLite veritabanı ve tablolar başarıyla hazırlandı: ototakip.db');
}

module.exports = {
    db,
    initDatabase
};