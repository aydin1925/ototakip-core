// profileController.js - Oto Servis Profil ve Ayarlar Denetleyicisi
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { db } = require('../infrastructure/database/db');
const { hashPassword } = require('../services/authService');
const { formatToTurkeyTime } = require('../utils/dateHelper');

// 1. Profil Sayfasını Görüntüle
function getProfilePage(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const workshop = db.prepare('SELECT * FROM workshops WHERE id = ?').get(workshopId);

        if (!workshop) {
            return res.redirect('/login');
        }

        // Son oturum giriş loglarını çek
        const rawLoginLogs = db.prepare(`
            SELECT * FROM workshop_login_logs 
            WHERE workshop_id = ? 
            ORDER BY created_at DESC 
            LIMIT 5
        `).all(workshopId);

        const loginLogs = rawLoginLogs.map(log => {
            const timeInfo = formatToTurkeyTime(log.created_at);
            return {
                ...log,
                created_at_raw: log.created_at,
                created_at: timeInfo.formatted,
                created_at_time: timeInfo.time,
                created_at_relative: timeInfo.relative
            };
        });

        res.render('dashboard/profile', {
            title: `${workshop.workshop_name} — Profil & Ayarlar`,
            workshop,
            loginLogs,
            currentPath: '/profil'
        });
    } catch (error) {
        console.error('Profil sayfası hatası:', error);
        res.status(500).send('Profil yüklenirken bir hata oluştu.');
    }
}

// 2. Genel Bilgileri ve İletişimi Güncelle
function updateGeneral(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const {
            workshop_name,
            owner_name,
            phone,
            landline_phone,
            email,
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
            return res.status(400).json({ success: false, message: 'Servis adı, yetkili adı ve telefon alanları zorunludur.' });
        }

        db.prepare(`
            UPDATE workshops SET 
                workshop_name = ?,
                owner_name = ?,
                phone = ?,
                landline_phone = ?,
                email = ?,
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
            (tax_office || '').trim(),
            (tax_number || '').trim(),
            service_type || 'private',
            opening_time || '08:30',
            closing_time || '18:30',
            working_days || 'pzt,sal,car,per,cum',
            (google_review_url || '').trim(),
            (instagram_username || '').trim().replace(/^@/, ''),
            (website_url || '').trim(),
            workshopId
        );

        // Session'daki workshop bilgisini güncelle
        const updatedWorkshop = db.prepare('SELECT * FROM workshops WHERE id = ?').get(workshopId);
        req.session.workshop = updatedWorkshop;

        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.json({ success: true, message: 'Genel bilgiler başarıyla güncellendi.' });
        }
        res.redirect('/profil?status=success&msg=' + encodeURIComponent('Genel bilgiler güncellendi.'));
    } catch (error) {
        console.error('Genel bilgi güncelleme hatası:', error);
        res.status(500).json({ success: false, message: 'Güncelleme sırasında hata oluştu: ' + error.message });
    }
}

// 3. Konum & Adres Güncelle
function updateLocation(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const { city, district, address, maps_link } = req.body;

        db.prepare(`
            UPDATE workshops SET 
                city = ?,
                district = ?,
                address = ?,
                maps_link = ?
            WHERE id = ?
        `).run(
            (city || '').trim(),
            (district || '').trim(),
            (address || '').trim(),
            (maps_link || '').trim(),
            workshopId
        );

        const updatedWorkshop = db.prepare('SELECT * FROM workshops WHERE id = ?').get(workshopId);
        req.session.workshop = updatedWorkshop;

        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.json({ success: true, message: 'Konum ve adres bilgileri güncellendi.' });
        }
        res.redirect('/profil?subpage=location&status=success&msg=' + encodeURIComponent('Konum bilgileri güncellendi.'));
    } catch (error) {
        console.error('Konum güncelleme hatası:', error);
        res.status(500).json({ success: false, message: 'Konum güncellenirken hata oluştu.' });
    }
}

// 4. Şifre Değiştir
function updateSecurity(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const { new_password, confirm_password } = req.body;

        if (!new_password || new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'Şifreniz en az 6 karakter olmalıdır.' });
        }

        if (new_password !== confirm_password) {
            return res.status(400).json({ success: false, message: 'Girdiğiniz yeni şifreler birbiriyle uyuşmuyor.' });
        }

        const newHash = hashPassword(new_password);
        db.prepare('UPDATE workshops SET password_hash = ? WHERE id = ?').run(newHash, workshopId);

        // Güvenlik logu ekle
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        db.prepare(`
            INSERT INTO workshop_login_logs (workshop_id, ip_address, is_success)
            VALUES (?, ?, 1)
        `).run(workshopId, String(clientIp));

        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.json({ success: true, message: 'Şifreniz başarıyla güncellendi.' });
        }
        res.redirect('/profil?subpage=security&status=success&msg=' + encodeURIComponent('Şifre başarıyla güncellendi.'));
    } catch (error) {
        console.error('Şifre güncelleme hatası:', error);
        res.status(500).json({ success: false, message: 'Şifre güncellenirken hata oluştu.' });
    }
}

// 5. Logo Yükleme
function uploadLogo(req, res) {
    try {
        const workshopId = req.session.workshopId;
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Lütfen bir resim dosyası seçiniz.' });
        }

        const relativePath = `/uploads/${req.file.filename}`;

        // Eski logo varsa silebiliriz
        const old = db.prepare('SELECT logo_url FROM workshops WHERE id = ?').get(workshopId);
        if (old && old.logo_url && old.logo_url.startsWith('/uploads/')) {
            const oldPath = path.join(__dirname, '../public', old.logo_url);
            if (fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch (e) {}
            }
        }

        db.prepare('UPDATE workshops SET logo_url = ? WHERE id = ?').run(relativePath, workshopId);

        const updatedWorkshop = db.prepare('SELECT * FROM workshops WHERE id = ?').get(workshopId);
        req.session.workshop = updatedWorkshop;

        res.json({ success: true, message: 'Logo başarıyla yüklendi.', logo_url: relativePath });
    } catch (error) {
        console.error('Logo yükleme hatası:', error);
        res.status(500).json({ success: false, message: 'Logo yüklenirken bir hata oluştu.' });
    }
}

// 6. Excel Dışa Aktarma: Müşteri & Araç Listesi
async function exportCustomers(req, res) {
    try {
        const workshopId = req.session.workshopId;
        const workshop = db.prepare('SELECT workshop_name FROM workshops WHERE id = ?').get(workshopId);

        const customers = db.prepare(`
            SELECT DISTINCT 
                plate as "Plaka",
                customer_name as "Müşteri Adı",
                customer_phone as "Telefon",
                car_model as "Araç Modeli",
                mileage as "Son Kilometre",
                created_at as "Kayıt Tarihi"
            FROM work_orders
            WHERE workshop_id = ?
            ORDER BY created_at DESC
        `).all(workshopId);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'OtoTakip Sistemi';
        const sheet = workbook.addWorksheet('Müşteriler ve Araçlar');

        sheet.columns = [
            { header: 'Plaka', key: 'plate', width: 16 },
            { header: 'Müşteri Adı', key: 'customer_name', width: 25 },
            { header: 'Telefon', key: 'customer_phone', width: 18 },
            { header: 'Araç Modeli', key: 'car_model', width: 25 },
            { header: 'Son KM', key: 'mileage', width: 14 },
            { header: 'Kayıt Tarihi', key: 'created_at', width: 20 },
        ];

        // Başlık stili
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };

        customers.forEach(c => sheet.addRow(c));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Musteri_Arac_Listesi_${Date.now()}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Müşteri export hatası:', error);
        res.status(500).send('Excel dosyası oluşturulurken hata meydana geldi.');
    }
}

// 7. Excel Dışa Aktarma: İş Emirleri & Gelir Raporu
async function exportOrders(req, res) {
    try {
        const workshopId = req.session.workshopId;

        const orders = db.prepare(`
            SELECT 
                wo.id as "İş Emri No",
                wo.plate as "Plaka",
                wo.customer_name as "Müşteri",
                wo.car_model as "Araç",
                wo.status as "Durum",
                wo.station as "İstasyon",
                COALESCE(sr.total_amount, 0) as "Toplam Tutar (TL)",
                wo.created_at as "Giriş Tarihi",
                wo.completed_at as "Teslim Tarihi"
            FROM work_orders wo
            LEFT JOIN service_receipts sr ON sr.work_order_id = wo.id
            WHERE wo.workshop_id = ?
            ORDER BY wo.created_at DESC
        `).all(workshopId);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'OtoTakip Sistemi';
        const sheet = workbook.addWorksheet('İş Emirleri');

        sheet.columns = [
            { header: 'İş Emri No', key: 'İş Emri No', width: 14 },
            { header: 'Plaka', key: 'Plaka', width: 16 },
            { header: 'Müşteri', key: 'Müşteri', width: 22 },
            { header: 'Araç', key: 'Araç', width: 22 },
            { header: 'Durum', key: 'Durum', width: 16 },
            { header: 'İstasyon', key: 'İstasyon', width: 14 },
            { header: 'Toplam Tutar (TL)', key: 'Toplam Tutar (TL)', width: 18 },
            { header: 'Giriş Tarihi', key: 'Giriş Tarihi', width: 20 },
            { header: 'Teslim Tarihi', key: 'Teslim Tarihi', width: 20 },
        ];

        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

        orders.forEach(o => sheet.addRow(o));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Is_Emirleri_Raporu_${Date.now()}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('İş emri export hatası:', error);
        res.status(500).send('Excel dosyası oluşturulurken hata meydana geldi.');
    }
}

module.exports = {
    getProfilePage,
    updateGeneral,
    updateLocation,
    updateSecurity,
    uploadLogo,
    exportCustomers,
    exportOrders
};
