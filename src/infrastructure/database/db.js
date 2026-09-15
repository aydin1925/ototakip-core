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
    console.log('✓ SQLite veritabanı ve tablolar başarıyla hazırlandı: ototakip.db');
}

module.exports = {
    db,
    initDatabase
};