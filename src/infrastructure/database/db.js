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

    // Migration: approval_requests tablosunda price kolonu yoksa ekle
    try {
        const approvalCols = db.prepare("PRAGMA table_info(approval_requests)").all();
        if (!approvalCols.some(col => col.name === 'price')) {
            db.exec("ALTER TABLE approval_requests ADD COLUMN price REAL DEFAULT 0;");
        }
    } catch (e) {
        // Pas geç
    }

    // Migration: service_receipts tablosu yoksa oluştur
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS service_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                work_order_id INTEGER NOT NULL UNIQUE,
                labor_cost REAL DEFAULT 0,
                parts_cost REAL DEFAULT 0,
                total_amount REAL DEFAULT 0,
                notes TEXT,
                items_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_service_receipts_work_order ON service_receipts(work_order_id);
        `);
    } catch (e) {
        // Pas geç
    }

    console.log('✓ SQLite veritabanı ve tablolar başarıyla hazırlandı: ototakip.db');
}

module.exports = {
    db,
    initDatabase
};