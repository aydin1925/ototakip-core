require('dotenv').config();
const {db, initDatabase} = require('./infrastructure/database/db.js');
const { connectToWhatsApp } = require('./infrastructure/whatsapp/baileysClient.js');
const { startWebServer } = require('./server.js');


console.log('=== OtoTakip Çekirdek Sistemi Başlatılıyor ===\n');

// Veritabanı dosyasını ve tablolarını oluştur
initDatabase();

// Test için örnek bir araç verisi ekleyelim
const insertOrder = db.prepare(`
    INSERT INTO work_orders (
       plate, customer_phone, customer_name, car_model, mileage, initial_complaint, status, station, estimated_delivery
    ) 
    VALUES (
       @plate, @customer_phone, @customer_name, @car_model, @mileage, @initial_complaint, @status, @station, @estimated_delivery
    )
`);
insertOrder.setAllowBareNamedParameters(true);

const testArac = {
    plate: '33 BCD 128',
    customer_phone: process.env.TEST_PHONE_NUMBER || '905000000000',
    customer_name: 'Mehmet Yılmaz',
    car_model: 'Dacia Sandero Stepway 1.0 TCE',
    mileage: 33000,
    initial_complaint: 'Ön takımdan lokurtu sesi geliyor, periyodik bakım',
    status: 'RECEIVED',
    station: 'Lift 3',
    estimated_delivery: '2026-09-18 17:30:00'
};

// Veritabanına daha önce eklenmiş mi?
let existing = db.prepare('SELECT * FROM work_orders WHERE plate = ?').get(testArac.plate);

if (!existing) {
    const result = insertOrder.run(testArac);
    existing = { id: result.lastInsertRowid };
    console.log(`✓ Test aracı veritabanına eklendi (ID: ${existing.id}, Plaka: ${testArac.plate})`);
} else {
    // Telefonu test numaramızla senkronize tut
    db.prepare('UPDATE work_orders SET customer_phone = ? WHERE id = ?').run(testArac.customer_phone, existing.id);
    console.log(`ℹ Test aracı zaten veritabanında kayıtlı (ID: ${existing.id}, Plaka: ${testArac.plate})`);
}

// 2. Test aracı için örnek bir parça onay talebi açalım
const existingRequest = db.prepare('SELECT * FROM approval_requests WHERE work_order_id = ?').get(existing.id);
if (!existingRequest) {
    db.prepare(`
        INSERT INTO approval_requests (work_order_id, part_name, note, status)
        VALUES (?, 'Ön Salıncak Burcu', '1.850 TL (Orijinal Mais) - Aşınmış ve boşluk yapmış', 'PENDING')
    `).run(existing.id);
    console.log('✓ Bekleyen onay talebi oluşturuldu: Ön Salıncak Burcu (Durum: PENDING)');
}

// 3. Veritabanındaki aktif durumları ekrana bas
const aktifAraclar = db.prepare('SELECT id, plate, customer_name, customer_phone, car_model, status FROM work_orders').all();
console.log('\n--- Aktif İş Emirleri ---');
console.table(aktifAraclar);

const aktifTalepler = db.prepare('SELECT id, work_order_id, part_name, note, status, responded_at FROM approval_requests').all();
console.log('--- Parça Onay Talepleri ---');
console.table(aktifTalepler);

console.log('\n=== Sistem Başarıyla Çalışıyor ===');

// 4. WhatsApp servisini ayağa kaldır
console.log('\n--- WhatsApp Servisi Başlatılıyor ---');
connectToWhatsApp();

// 5. Express Web Sunucusunu Başlat
startWebServer();