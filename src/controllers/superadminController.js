// superadminController.js - SaaS SüperAdmin Konsol Denetleyicisi
const { db } = require('../infrastructure/database/db');
const { hashPassword, verifyPassword, sanitizePhone } = require('../services/authService');
const { getSocket } = require('../infrastructure/whatsapp/baileysClient');
const { formatToTurkeyTime } = require('../utils/dateHelper');
const path = require('path');
const fs = require('fs');

// 1. Giriş Sayfası
function getLoginPage(req, res) {
    if (req.session && req.session.isSuperAdmin) {
        return res.redirect('/superadmin');
    }
    res.render('superadmin/login', {
        title: 'SüperAdmin Konsolu Girişi — OtoTakip',
        error: req.query.error || null,
        layout: false // Bağımsız tam ekran giriş sayfası
    });
}

// 2. Giriş Yap
function postLogin(req, res) {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.redirect('/superadmin/login?error=' + encodeURIComponent('Kullanıcı adı ve şifre gereklidir.'));
        }

        const admin = db.prepare('SELECT * FROM superadmins WHERE username = ?').get(username.trim());
        if (!admin) {
            return res.redirect('/superadmin/login?error=' + encodeURIComponent('Hatalı kullanıcı adı veya şifre.'));
        }

        const isValid = verifyPassword(password, admin.password_hash);
        if (!isValid) {
            return res.redirect('/superadmin/login?error=' + encodeURIComponent('Hatalı kullanıcı adı veya şifre.'));
        }

        req.session.isSuperAdmin = true;
        req.session.superadmin = {
            id: admin.id,
            username: admin.username,
            email: admin.email
        };

        // Audit log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, details, ip_address)
            VALUES (?, 'ADMIN_LOGIN', 'SYSTEM', 'SüperAdmin oturum açtı', ?)
        `).run(admin.id, req.ip || '127.0.0.1');

        res.redirect('/superadmin');
    } catch (error) {
        console.error('SüperAdmin login hatası:', error);
        res.redirect('/superadmin/login?error=' + encodeURIComponent('Giriş yapılırken sistem hatası oluştu.'));
    }
}

// 3. Çıkış Yap
function logout(req, res) {
    if (req.session) {
        req.session.isSuperAdmin = false;
        req.session.superadmin = null;
    }
    res.redirect('/superadmin/login');
}

// 4. Ana Dashboard Konsolu
function getDashboard(req, res) {
    try {
        // Tüm servisler ve zenginleştirilmiş gerçek verileri
        const rawServices = db.prepare(`
            SELECT 
                w.*,
                (SELECT COUNT(*) FROM work_orders wo WHERE wo.workshop_id = w.id AND wo.status != 'DELIVERED') as active_orders_count,
                (SELECT COUNT(*) FROM work_orders wo WHERE wo.workshop_id = w.id AND wo.status = 'DELIVERED') as delivered_orders_count,
                (SELECT COUNT(*) FROM work_orders wo WHERE wo.workshop_id = w.id) as total_orders_count,
                (SELECT COALESCE(SUM(sr.total_amount), 0) FROM work_orders wo JOIN service_receipts sr ON sr.work_order_id = wo.id WHERE wo.workshop_id = w.id) as total_revenue
            FROM workshops w
            ORDER BY w.id DESC
        `).all();

        const services = rawServices.map(srv => {
            const timeInfo = formatToTurkeyTime(srv.created_at);
            return {
                ...srv,
                created_at_formatted: timeInfo.formatted,
                created_at_relative: timeInfo.relative
            };
        });

        // Platform Temel Metrikleri
        const totalServices = services.length;
        const activeServices = services.filter(s => s.is_active === 1).length;
        const suspendedServices = totalServices - activeServices;
        
        let totalLifts = 0;
        let totalActiveOrders = 0;
        let platformTotalRevenue = 0;
        services.forEach(s => {
            totalLifts += Number(s.capacity || 3);
            totalActiveOrders += Number(s.active_orders_count || 0);
            platformTotalRevenue += Number(s.total_revenue || 0);
        });

        // Gerçek İş Emri & Ciro İstatistikleri
        const orderStats = db.prepare(`
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered_orders,
                COALESCE(SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END), 0) as ready_orders,
                COALESCE(SUM(CASE WHEN status = 'REPAIRING' THEN 1 ELSE 0 END), 0) as repairing_orders,
                COALESCE(SUM(CASE WHEN status = 'INSPECTING' THEN 1 ELSE 0 END), 0) as inspecting_orders,
                COALESCE(SUM(CASE WHEN status = 'RECEIVED' THEN 1 ELSE 0 END), 0) as received_orders
            FROM work_orders
        `).get();

        // WhatsApp Onay İstatistikleri
        const approvalStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END), 0) as approved,
                COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END), 0) as rejected,
                COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending,
                COALESCE(SUM(price), 0) as total_value
            FROM approval_requests
        `).get();

        // WhatsApp Mesaj Sayısı
        const totalMessages = db.prepare('SELECT COUNT(*) as count FROM customer_messages').get().count;

        // Gerçek Medya & WebP Depolama Metresi
        const uploadsDir = path.resolve(__dirname, '../../public/uploads');
        let uploadBytes = 0;
        let uploadFilesCount = 0;
        if (fs.existsSync(uploadsDir)) {
            const scanDir = (dir) => {
                const files = fs.readdirSync(dir);
                for (const f of files) {
                    const fullP = path.join(dir, f);
                    const st = fs.statSync(fullP);
                    if (st.isDirectory()) scanDir(fullP);
                    else if (st.isFile()) {
                        uploadBytes += st.size;
                        uploadFilesCount++;
                    }
                }
            };
            scanDir(uploadsDir);
        }

        const mediaStats = {
            bytes: uploadBytes,
            formattedSize: uploadBytes > 1024 * 1024 
                ? (uploadBytes / (1024 * 1024)).toFixed(2) + ' MB' 
                : (uploadBytes / 1024).toFixed(1) + ' KB',
            fileCount: uploadFilesCount,
            savedBytesApprox: Math.round(uploadBytes * 2.5), // WebP ~%70 tasarruf tahmini
            savedFormatted: ((uploadBytes * 2.5) / 1024).toFixed(1) + ' KB'
        };

        // Veritabanı ve Sistem Sağlığı
        const dbFile = path.resolve(__dirname, '../../ototakip.db');
        const dbStats = fs.existsSync(dbFile) ? fs.statSync(dbFile) : { size: 0 };
        const dbTablesCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count;
        
        // Sunucu Uptime & RAM
        const uptimeSec = Math.floor(process.uptime());
        const uptimeHours = Math.floor(uptimeSec / 3600);
        const uptimeMinutes = Math.floor((uptimeSec % 3600) / 60);
        const uptimeFormatted = `${uptimeHours} saat ${uptimeMinutes} dk`;
        const memoryFormatted = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1) + ' MB';

        // WhatsApp Gateway Sağlığı
        const socket = getSocket();
        const isWhatsappConnected = Boolean(socket && socket.user);

        // Denetim Günlüğü (Son 50 kayıt - Zenginleştirilmiş Dinamik Veri)
        const rawLogs = db.prepare(`
            SELECT al.*, sa.username as admin_username
            FROM audit_logs al
            LEFT JOIN superadmins sa ON sa.id = al.admin_id
            ORDER BY al.id DESC
            LIMIT 50
        `).all();

        const auditLogs = rawLogs.map(log => {
            let category = 'system';
            let action_label = log.action;
            let icon = 'fa-clock';

            if (log.action === 'ADMIN_LOGIN') {
                category = 'auth';
                action_label = 'Giriş Yapıldı';
                icon = 'fa-key';
            } else if (log.action === 'SERVICE_CREATE') {
                category = 'service';
                action_label = 'Yeni Servis';
                icon = 'fa-plus';
            } else if (log.action === 'STATUS_CHANGE') {
                category = 'service';
                action_label = 'Durum Değişti';
                icon = 'fa-power-off';
            } else if (log.action === 'CAPACITY_UPDATE') {
                category = 'service';
                action_label = 'Lift Güncellendi';
                icon = 'fa-car-side';
            } else if (log.action === 'SERVICE_PROFILE_UPDATE') {
                category = 'service';
                action_label = 'Profil Düzenlendi';
                icon = 'fa-pen-to-square';
            } else if (log.action === 'IMPERSONATE') {
                category = 'auth';
                action_label = 'Usta Masasına Geçiş';
                icon = 'fa-arrow-right-to-bracket';
            } else if (log.action === 'BACKUP_DOWNLOAD') {
                category = 'system';
                action_label = 'Yedek İndirildi';
                icon = 'fa-database';
            } else if (log.action === 'ANALYTICS_EXPORT') {
                category = 'system';
                action_label = 'CSV Raporu';
                icon = 'fa-file-excel';
            }

            // Türkiye saati (GMT+3) ve göreli zaman hesaplaması
            const timeInfo = formatToTurkeyTime(log.created_at);

            return {
                ...log,
                created_at_raw: log.created_at, // Orijinal UTC
                created_at: timeInfo.formatted,  // Türkiye yerel saati: "02.10.2026 11:53:37"
                created_at_time: timeInfo.time,  // "11:53:37"
                created_at_date: timeInfo.date,  // "02.10.2026"
                created_at_relative: timeInfo.relative, // "4 dk önce"
                category,
                action_label,
                icon
            };
        });

        // Şehir Dağılımı
        const cityStats = db.prepare(`
            SELECT COALESCE(NULLIF(city, ''), 'Diğer') as city, COUNT(*) as count 
            FROM workshops 
            GROUP BY city 
            ORDER BY count DESC 
            LIMIT 4
        `).all();

        res.render('superadmin/index', {
            title: 'SaaS SüperAdmin Konsolu — OtoTakip',
            services,
            totalServices,
            activeServices,
            suspendedServices,
            totalLifts,
            totalActiveOrders,
            platformTotalRevenue,
            orderStats,
            approvalStats,
            totalMessages,
            mediaStats,
            dbStats: {
                sizeFormatted: (dbStats.size / 1024).toFixed(1) + ' KB',
                tablesCount: dbTablesCount
            },
            systemHealth: {
                uptime: uptimeFormatted,
                memory: memoryFormatted,
                nodeVersion: process.version
            },
            cityStats,
            isWhatsappConnected,
            auditLogs,
            adminUser: req.session.superadmin,
            layout: 'layouts/superadmin'
        });
    } catch (error) {
        console.error('SüperAdmin dashboard hatası:', error);
        res.status(500).send('SüperAdmin konsolu yüklenirken hata oluştu: ' + error.message);
    }
}

// 5. Yeni Servis Ekle (SüperAdmin tarafından lift kapasitesi belirlenir)
function createService(req, res) {
    try {
        const { workshop_name, owner_name, phone, capacity, city, district, password } = req.body;

        if (!workshop_name || !owner_name || !phone) {
            return res.status(400).json({ success: false, message: 'Servis adı, yetkili ve telefon alanları zorunludur.' });
        }

        const cleanPhone = sanitizePhone(phone);
        const existing = db.prepare('SELECT id FROM workshops WHERE phone = ?').get(cleanPhone);
        if (existing) {
            return res.status(400).json({ success: false, message: 'Bu telefon numarasıyla kayıtlı bir servis zaten mevcut.' });
        }

        const pass = password && password.length >= 6 ? password : '123456'; // Varsayılan geçici şifre
        const password_hash = hashPassword(pass);
        const liftCapacity = parseInt(capacity, 10) || 3;

        const result = db.prepare(`
            INSERT INTO workshops (
                workshop_name, owner_name, phone, capacity, city, district, password_hash, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
            workshop_name.trim(),
            owner_name.trim(),
            cleanPhone,
            liftCapacity,
            (city || 'İstanbul').trim(),
            (district || 'Kartal').trim(),
            password_hash
        );

        // Audit Log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
            VALUES (?, 'SERVICE_CREATE', 'SERVICE', ?, ?, ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            result.lastInsertRowid,
            `Yeni servis kaydedildi: ${workshop_name} (Lift: ${liftCapacity})`,
            req.ip || '127.0.0.1'
        );

        res.json({ success: true, message: 'Servis başarıyla sisteme kaydedildi.', serviceId: result.lastInsertRowid });
    } catch (error) {
        console.error('Yeni servis oluşturma hatası:', error);
        res.status(500).json({ success: false, message: 'Servis eklenirken hata: ' + error.message });
    }
}

// 6. Servis Durumunu Değiştir (Aktif / Askıda)
function toggleServiceStatus(req, res) {
    try {
        const serviceId = parseInt(req.params.id, 10);
        const current = db.prepare('SELECT id, workshop_name, is_active FROM workshops WHERE id = ?').get(serviceId);

        if (!current) {
            return res.status(404).json({ success: false, message: 'Servis bulunamadı.' });
        }

        const newStatus = current.is_active === 1 ? 0 : 1;
        db.prepare('UPDATE workshops SET is_active = ? WHERE id = ?').run(newStatus, serviceId);

        // Audit Log
        const actionLabel = newStatus === 1 ? 'AKTİFLEŞTİRİLDİ' : 'ASKIYA ALINDI';
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
            VALUES (?, 'STATUS_CHANGE', 'SERVICE', ?, ?, ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            serviceId,
            `${current.workshop_name} durumu değiştirildi: ${actionLabel}`,
            req.ip || '127.0.0.1'
        );

        res.json({ success: true, message: `Servis ${actionLabel.toLowerCase()}.`, is_active: newStatus });
    } catch (error) {
        console.error('Servis durum güncelleme hatası:', error);
        res.status(500).json({ success: false, message: 'Durum güncellenemedi.' });
    }
}

// 7. Servis Lift Kapasitesini Güncelle (Sadece SüperAdmin)
function updateServiceCapacity(req, res) {
    try {
        const serviceId = parseInt(req.params.id, 10);
        const capacity = parseInt(req.body.capacity, 10);

        if (!capacity || capacity < 1) {
            return res.status(400).json({ success: false, message: 'Geçersiz lift kapasitesi.' });
        }

        db.prepare('UPDATE workshops SET capacity = ? WHERE id = ?').run(capacity, serviceId);

        // Audit Log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
            VALUES (?, 'CAPACITY_UPDATE', 'SERVICE', ?, ?, ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            serviceId,
            `Lift kapasitesi ${capacity} olarak güncellendi`,
            req.ip || '127.0.0.1'
        );

        res.json({ success: true, message: `Lift kapasitesi ${capacity} olarak güncellendi.` });
    } catch (error) {
        console.error('Kapasite güncelleme hatası:', error);
        res.status(500).json({ success: false, message: 'Kapasite güncellenemedi.' });
    }
}

// 8. Impersonation (Usta Masasına SüperAdmin Olarak Geçiş)
function impersonate(req, res) {
    try {
        const serviceId = parseInt(req.params.id, 10);
        const target = db.prepare('SELECT * FROM workshops WHERE id = ?').get(serviceId);

        if (!target) {
            return res.status(404).send('Servis bulunamadı.');
        }

        // Ustanın oturumunu başlat ama admin olduğunu unutma
        req.session.workshopId = target.id;
        req.session.workshop = target;
        req.session.impersonatedByAdmin = true;

        // Audit Log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
            VALUES (?, 'IMPERSONATE', 'SERVICE', ?, ?, ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            serviceId,
            `${target.workshop_name} (#${serviceId}) paneline impersonate ile geçiş yapıldı`,
            req.ip || '127.0.0.1'
        );

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Impersonate hatası:', error);
        res.status(500).send('Servis paneline geçiş yapılırken hata oluştu.');
    }
}

// 9. Veritabanı Yedeği İndir
function downloadBackup(req, res) {
    try {
        const dbFile = path.resolve(__dirname, '../../ototakip.db');
        if (!fs.existsSync(dbFile)) {
            return res.status(404).send('Yedek dosyası bulunamadı.');
        }

        // Audit Log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, details, ip_address)
            VALUES (?, 'BACKUP_DOWNLOAD', 'SYSTEM', 'Sistem veritabanı yedeği indirildi', ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            req.ip || '127.0.0.1'
        );

        res.download(dbFile, `ototakip_backup_${Date.now()}.db`);
    } catch (error) {
        console.error('Yedek indirme hatası:', error);
        res.status(500).send('Yedek dosyası indirilemedi.');
    }
}

// 10. Platform Analiz Raporu (.csv) İndir
function exportAnalyticsCsv(req, res) {
    try {
        const services = db.prepare(`
            SELECT 
                w.id,
                w.workshop_name,
                w.owner_name,
                w.phone,
                w.email,
                w.city,
                w.district,
                w.capacity,
                w.is_active,
                (SELECT COUNT(*) FROM work_orders wo WHERE wo.workshop_id = w.id AND wo.status != 'DELIVERED') as active_orders,
                (SELECT COUNT(*) FROM work_orders wo WHERE wo.workshop_id = w.id AND wo.status = 'DELIVERED') as delivered_orders,
                (SELECT COUNT(*) FROM work_orders wo WHERE wo.workshop_id = w.id) as total_orders,
                (SELECT COALESCE(SUM(sr.total_amount), 0) FROM work_orders wo JOIN service_receipts sr ON sr.work_order_id = wo.id WHERE wo.workshop_id = w.id) as revenue
            FROM workshops w
            ORDER BY w.id ASC
        `).all();

        // UTF-8 BOM ile Excel uyumlu CSV
        let csv = '\uFEFFServis Kodu;Servis Adı;Yetkili Usta;Telefon;E-Posta;İl;İlçe;Tanımlı Lift;Aktif İş Emri;Teslim Edilen;Toplam İş Emri;Ciro (TL);Durum\r\n';
        
        services.forEach(s => {
            const status = s.is_active === 1 ? 'Aktif' : 'Askıda';
            csv += `SRV-${String(s.id).padStart(4, '0')};"${s.workshop_name}";"${s.owner_name}";"${s.phone}";"${s.email || ''}";"${s.city || ''}";"${s.district || ''}";${s.capacity || 3};${s.active_orders || 0};${s.delivered_orders || 0};${s.total_orders || 0};${s.revenue || 0};${status}\r\n`;
        });

        // Audit Log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, details, ip_address)
            VALUES (?, 'ANALYTICS_EXPORT', 'SYSTEM', 'Platform analiz raporu (.csv) indirildi', ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            req.ip || '127.0.0.1'
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=ototakip_analiz_raporu_${Date.now()}.csv`);
        res.send(Buffer.from(csv, 'utf8'));
    } catch (error) {
        console.error('CSV export hatası:', error);
        res.status(500).send('Analiz raporu oluşturulamadı.');
    }
}

// 11. WhatsApp Gateway Test API
function testWhatsapp(req, res) {
    try {
        const socket = getSocket();
        const connected = Boolean(socket && socket.user);
        let phone = null;
        if (connected && socket.user.id) {
            phone = socket.user.id.split(':')[0];
        }

        res.json({
            success: true,
            connected,
            phone,
            message: connected 
                ? `WhatsApp hattı aktif ve bağlı (+${phone})` 
                : 'WhatsApp Web soket bağlantısı bekleniyor veya çevrimdışı.'
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Test başarısız: ' + e.message });
    }
}

// 12. SüperAdmin Tarafından Servis Profilini Güncelle
function updateServiceProfile(req, res) {
    try {
        const serviceId = parseInt(req.params.id, 10);
        const {
            workshop_name,
            owner_name,
            phone,
            landline_phone,
            email,
            city,
            district,
            address,
            maps_link,
            tax_office,
            tax_number,
            service_type,
            opening_time,
            closing_time,
            working_days,
            google_review_url,
            instagram_username,
            website_url
        } = req.body;

        if (!workshop_name || !owner_name || !phone) {
            return res.status(400).json({ success: false, message: 'Servis adı, yetkili ve telefon alanları zorunludur.' });
        }

        db.prepare(`
            UPDATE workshops SET
                workshop_name = ?,
                owner_name = ?,
                phone = ?,
                landline_phone = ?,
                email = ?,
                city = ?,
                district = ?,
                address = ?,
                maps_link = ?,
                tax_office = ?,
                tax_number = ?,
                service_type = ?,
                opening_time = ?,
                closing_time = ?,
                working_days = ?,
                google_review_url = ?,
                instagram_username = ?,
                website_url = ?
            WHERE id = ?
        `).run(
            workshop_name.trim(),
            owner_name.trim(),
            phone.trim(),
            (landline_phone || '').trim(),
            (email || '').trim(),
            (city || '').trim(),
            (district || '').trim(),
            (address || '').trim(),
            (maps_link || '').trim(),
            (tax_office || '').trim(),
            (tax_number || '').trim(),
            service_type || 'private',
            opening_time || '08:30',
            closing_time || '18:30',
            working_days || 'pzt,sal,car,per,cum',
            (google_review_url || '').trim(),
            (instagram_username || '').trim().replace(/^@/, ''),
            (website_url || '').trim(),
            serviceId
        );

        // Audit Log
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip_address)
            VALUES (?, 'SERVICE_PROFILE_UPDATE', 'SERVICE', ?, ?, ?)
        `).run(
            req.session.superadmin ? req.session.superadmin.id : 1,
            serviceId,
            `SüperAdmin tarafından ${workshop_name} (#${serviceId}) profili güncellendi`,
            req.ip || '127.0.0.1'
        );

        res.json({ success: true, message: `${workshop_name} profil bilgileri başarıyla güncellendi.` });
    } catch (error) {
        console.error('SüperAdmin profil güncelleme hatası:', error);
        res.status(500).json({ success: false, message: 'Güncelleme yapılamadı: ' + error.message });
    }
}

module.exports = {
    getLoginPage,
    postLogin,
    logout,
    getDashboard,
    createService,
    toggleServiceStatus,
    updateServiceCapacity,
    impersonate,
    downloadBackup,
    exportAnalyticsCsv,
    testWhatsapp,
    updateServiceProfile
};
