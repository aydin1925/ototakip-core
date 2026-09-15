const {db, initDatabase} = require('./infrastructure/database/db.js');
const { connectToWhatsApp } = require('./infrastructure/whatsapp/baileysClient.js')


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
    customer_phone: '905320000000',
    customer_name: 'Mehmet Yılmaz',
    car_model: 'Dacia Sandero Stepway 1.0 TCE',
    mileage: 33000,
    initial_complaint: 'Ön takımdan lokurtu sesi geliyor, periyodik bakım',
    status: 'RECEIVED',
    station: 'Lift 3',
    estimated_delivery: '2026-09-18 17:30:00'
};

// Veritabanına daha önce eklenmiş mi?
const existing = db.prepare('SELECT * FROM work_orders WHERE plate = ?').get(testArac.plate);

if (!existing) {
    const result = insertOrder.run(testArac);
    console.log(`✓ Test aracı veritabanına eklendi (ID: ${result.lastInsertRowid}, Plaka: ${testArac.plate})`);
} else {
    console.log(`ℹ Test aracı zaten veritabanında kayıtlı (ID: ${existing.id}, Durum: ${existing.status})`);
}

// 3. Veritabanındaki araçları ekrana tablo olarak bas
const aktifAraclar = db.prepare('SELECT id, plate, customer_name, car_model, mileage, status, estimated_delivery FROM work_orders').all();

console.log('\n--- Veritabanındaki Aktif İş Emirleri ---');
console.table(aktifAraclar);
console.log('\n=== Sistem Başarıyla Çalışıyor ===');

// 4. WhatsApp servisini ayağa kaldır
console.log('\n--- WhatsApp Servisi Başlatılıyor ---');
connectToWhatsApp();