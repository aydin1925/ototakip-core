-- 0. ATÖLYELER VE USTALAR (GİRİŞ VE KAYIT HESAPLARI)
CREATE TABLE IF NOT EXISTS workshops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_name TEXT NOT NULL,          -- Atölye / Dükkan Adı (örn: 'Yılmaz Oto Servis')
    owner_name TEXT NOT NULL,             -- Usta / Yetkili Adı (örn: 'Ahmet Yılmaz')
    phone TEXT NOT NULL UNIQUE,           -- Giriş için telefon numarası (örn: '905321112233')
    email TEXT,                           -- E-posta (opsiyonel)
    password_hash TEXT NOT NULL,          -- Kriptolanmış şifre özeti
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workshops_phone ON workshops(phone);

-- 1. İŞ EMİRLERİ (ARAÇLAR) TABLOSU
CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_id INTEGER DEFAULT 1,         -- Hangi atölyeye ait?
    plate TEXT NOT NULL,                   -- Plaka (örn: '34 BJK 1903')
    customer_phone TEXT NOT NULL,          -- Müşteri Telefonu
    customer_name TEXT,                    -- Müşteri Adı
    car_model TEXT NOT NULL,               -- Araç Marka/Model (örn: 'Golf 1.5 eTSI')
    mileage INTEGER,                       -- Kilometre (AI arıza analizi için)
    initial_complaint TEXT,                -- Müşteri şikayeti
    diagnostic_notes TEXT,                 -- Ustanın teşhis notu
    status TEXT NOT NULL DEFAULT 'RECEIVED', -- 'RECEIVED', 'INSPECTING', 'REPAIRING', 'READY', 'DELIVERED'
    station TEXT DEFAULT 'Lift 1',         -- Hangi lifte bağlı?
    estimated_delivery DATETIME,           -- Esnek teslim zamanı (saat veya tarih)
    completed_at DATETIME,                 -- Gerçek teslim saati (Süre ölçümü ve AI için)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. PARÇA / İŞLEM ONAY TALEPLERİ
CREATE TABLE IF NOT EXISTS approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL,
    part_name TEXT NOT NULL,               -- Değişecek parça adı
    note TEXT,                             -- Usta açıklaması
    status TEXT NOT NULL DEFAULT 'PENDING',-- 'PENDING', 'APPROVED', 'REJECTED'
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME,                 -- Müşterinin onayladığı an
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- 3. YAPILAN İŞLEMLER / PARÇA ARŞİVİ (YILLIK RAPORLAR VE AI İÇİN)
CREATE TABLE IF NOT EXISTS service_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL,
    category TEXT NOT NULL,                -- 'Fren', 'Süspansiyon', 'Periyodik', 'Motor'
    operation_name TEXT NOT NULL,          -- 'Ön Salıncak Burcu Değişimi'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- 4. ATÖLYE FOTOĞRAFLARI
CREATE TABLE IF NOT EXISTS service_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL,
    tag TEXT NOT NULL,                     -- 'Sökülen Parça', 'Yeni Orijinal', 'Genel'
    description TEXT,
    file_path TEXT NOT NULL,               -- Fotoğrafın sunucudaki yolu
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- 5. MÜŞTERİ VE USTA MESAJLAŞMA GEÇMİŞİ (WHATSAPP CRM)
CREATE TABLE IF NOT EXISTS customer_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL,          -- 'CUSTOMER' (müşteri) veya 'MECHANIC' (usta)
    message_text TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE
);

-- Hızlı Arama İndeksleri
CREATE INDEX IF NOT EXISTS idx_work_orders_plate ON work_orders(plate);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_customer_messages_work_order ON customer_messages(work_order_id);