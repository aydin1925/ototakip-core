// workshopService.js - Lift, araç iş emirleri ve onay kayıtları SQLite iş mantığı
const { db } = require('../infrastructure/database/db');
const { sanitizePhone } = require('./authService');

/**
 * 1. Usta Paneli (Dashboard) Verilerini Getir
 * Belirli bir atölyenin liftlerindeki aktif araçları ve parça onay durumlarını çeker.
 */

function getDashboardData(workshopId = 1) {
    // Teslim edilmişler dışındaki tüm aktif iş emirlerini çek
    const workOrders = db.prepare(`SELECT * FROM work_orders 
        WHERE workshop_id = ? AND status != 'DELIVERED' 
        ORDER BY 
            CASE 
                WHEN status = 'INSPECTING' THEN 1
                WHEN status = 'WAITING_PARTS' THEN 2
                WHEN status = 'REPAIRING' THEN 3
                WHEN status = 'TESTING' THEN 4
                WHEN status = 'RECEIVED' THEN 5
                WHEN status = 'READY' THEN 6
                ELSE 7
            END,
            created_at DESC`).all(workshopId);

    // Her aracın aktif parça onay taleplerini iliştir
    const approvalStmt = db.prepare(`
        SELECT * FROM approval_requests
        WHERE work_order_id = ?
        ORDER BY requested_at DESC
        `);
    
    return workOrders.map(order => {
        const approvals = approvalStmt.all(order.id);
        const hasPendingApproval = approvals.some(a => a.status === 'PENDING');
        const hasApproved = approvals.some(a => a.status === 'APPROVED');

        return {
            ...order,
            approvals,
            hasPendingApproval,
            hasApproved
        };
    });
}

  /**
 * 2. Tek Bir Aracın Tüm Süreç Detaylarını Getir
 * 4 aşamalı takip, onay geçmişi ve servis fotoğraflarını toplar.
 */
function getWorkOrderDetail(workOrderId, workshopId = 1) {
    const workOrder = db.prepare(`
        SELECT * FROM work_orders 
        WHERE id = ? AND workshop_id = ?
    `).get(workOrderId, workshopId);
    if (!workOrder) {
        throw new Error('Araç iş emri bulunamadı.');
    }
    // Bu araca ait onay talepleri (WhatsApp üzerinden giden/gelen)
    const approvals = db.prepare(`
        SELECT * FROM approval_requests 
        WHERE work_order_id = ? 
        ORDER BY requested_at DESC
    `).all(workOrderId);
    // Bu araca ait fotoğraflar
    const photos = db.prepare(`
        SELECT *, file_path as photo_path, description as caption 
        FROM service_photos 
        WHERE work_order_id = ? 
        ORDER BY created_at DESC
    `).all(workOrderId);

    // Bu araca ait müşteri-usta mesajlaşma geçmişi
    const messages = db.prepare(`
        SELECT * FROM customer_messages 
        WHERE work_order_id = ? 
        ORDER BY created_at ASC
    `).all(workOrderId);

    // Bu araca ait dijital servis fişi / hesap özeti (varsa)
    const receipt = getReceiptByWorkOrderId(workOrderId);

    return {
        ...workOrder,
        approvals,
        photos,
        messages,
        receipt
    };
}
/**
 * 3. Araç Aşamasını Güncelle (Kabul -> Teşhis -> Onarım -> Hazır -> Teslim Edildi)
 */
function updateStage(workOrderId, newStatus, workshopId = 1) {
    const validStatuses = ['RECEIVED', 'INSPECTING', 'WAITING_PARTS', 'REPAIRING', 'TESTING', 'READY', 'DELIVERED'];
    if (!validStatuses.includes(newStatus)) {
        throw new Error('Geçersiz aşama durumu.');
    }
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    // Eğer teslim edildiyse completed_at saatini de damgala
    if (newStatus === 'DELIVERED') {
        const stmt = db.prepare(`
            UPDATE work_orders 
            SET status = ?, updated_at = ?, completed_at = ?
            WHERE id = ? AND workshop_id = ?
        `);
        return stmt.run(newStatus, now, now, workOrderId, workshopId);
    }
    // Başka bir aşamaya çekildiyse completed_at'i sıfırla (geri alma senaryoları için)
    const stmt = db.prepare(`
        UPDATE work_orders 
        SET status = ?, updated_at = ?, completed_at = NULL
        WHERE id = ? AND workshop_id = ?
    `);
    return stmt.run(newStatus, now, workOrderId, workshopId);
}
/**
 * 4. Yeni Araç Kabulü (İş Emri Açma)
 */
function createWorkOrder(data, workshopId = 1) {
    const { plate, customer_phone, customer_name, car_model, station, initial_complaint, estimated_delivery } = data;
    if (!plate || !customer_phone || !car_model) {
        throw new Error('Plaka, müşteri telefonu ve araç modeli zorunludur.');
    }
    const cleanPhone = sanitizePhone(customer_phone);
    const stmt = db.prepare(`
        INSERT INTO work_orders (
            workshop_id, plate, customer_phone, customer_name, 
            car_model, station, initial_complaint, estimated_delivery, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')
    `);
    const result = stmt.run(
        workshopId,
        plate.toUpperCase().trim(),
        cleanPhone,
        customer_name ? customer_name.trim() : null,
        car_model.trim(),
        station || 'Lift 1',
        initial_complaint || null,
        estimated_delivery || null
    );
    return {
        id: Number(result.lastInsertRowid),
        ...data,
        customer_phone: cleanPhone,
        status: 'RECEIVED'
    };
}

/**
 * 5. Müşteri İçin Plakaya Göre Canlı Takip Verisini Getir (Public)
 */
function getTrackingDataByPlate(rawPlate) {
    if (!rawPlate) {
        throw new Error('Geçersiz plaka.');
    }

    const cleanPlate = rawPlate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // Plakayı boşluksuz eşleştir ve en güncel kaydı getir
    const workOrder = db.prepare(`
        SELECT w.*, ws.workshop_name, ws.phone as workshop_phone
        FROM work_orders w
        LEFT JOIN workshops ws ON ws.id = w.workshop_id
        WHERE REPLACE(UPPER(w.plate), ' ', '') = ?
        ORDER BY w.id DESC
        LIMIT 1
    `).get(cleanPlate);

    if (!workOrder) {
        return null;
    }

    // Onay bekleyen veya onaylanmış parça talepleri
    const approvals = db.prepare(`
        SELECT * FROM approval_requests 
        WHERE work_order_id = ? 
        ORDER BY requested_at DESC
    `).all(workOrder.id);

    // Servis ve parça fotoğrafları
    const photos = db.prepare(`
        SELECT *, file_path as photo_path, description as caption 
        FROM service_photos 
        WHERE work_order_id = ? 
        ORDER BY created_at DESC
    `).all(workOrder.id);

    // Varsa dijital servis fişi / hesap özeti
    const receipt = getReceiptByWorkOrderId(workOrder.id);

    return {
        ...workOrder,
        approvals,
        photos,
        receipt
    };
}

/**
 * 6. Yeni Parça Onay Talebi Aç
 */
function createApprovalRequest(workOrderId, partName, note, rawPrice = 0) {
    if (!workOrderId || !partName) {
        throw new Error('İş emri ve parça adı zorunludur.');
    }

    let price = Number(rawPrice) || 0;
    // Eğer fiyat ayrıca girilmediyse, note içindeki '1.200 TL' veya '1200 TL' kalıbını otomatik ayıkla
    if (price === 0 && note) {
        const match = note.match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+)\s*(?:TL|tl)/);
        if (match) {
            price = parseFloat(match[1].replace(/\./g, '').replace(',', '.')) || 0;
        }
    }

    const stmt = db.prepare(`
        INSERT INTO approval_requests (work_order_id, part_name, price, note, status)
        VALUES (?, ?, ?, ?, 'PENDING')
    `);

    const result = stmt.run(workOrderId, partName.trim(), price, note ? note.trim() : null);

    return {
        id: Number(result.lastInsertRowid),
        work_order_id: workOrderId,
        part_name: partName.trim(),
        price,
        note: note ? note.trim() : null,
        status: 'PENDING'
    };
}

/**
 * 7. Ustanın Müşteriye Yazdığı Yanıtı Kaydet
 */
function saveMechanicReply(workOrderId, replyText) {
    if (!workOrderId || !replyText) {
        throw new Error('İş emri ve cevap metni zorunludur.');
    }

    const stmt = db.prepare(`
        INSERT INTO customer_messages (work_order_id, sender_type, message_text, is_read)
        VALUES (?, 'MECHANIC', ?, 1)
    `);

    const result = stmt.run(workOrderId, replyText.trim());

    return {
        id: Number(result.lastInsertRowid),
        work_order_id: workOrderId,
        sender_type: 'MECHANIC',
        message_text: replyText.trim()
    };
}

/**
 * 8. Araca Servis / Parça Fotoğrafı Ekle
 */
function addServicePhoto(workOrderId, photoPath, caption = '', tag = 'Ekspertiz') {
    if (!workOrderId || !photoPath) {
        throw new Error('İş emri ve fotoğraf yolu zorunludur.');
    }

    const stmt = db.prepare(`
        INSERT INTO service_photos (work_order_id, tag, description, file_path)
        VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(workOrderId, tag, caption ? caption.trim() : null, photoPath);

    return {
        id: Number(result.lastInsertRowid),
        work_order_id: workOrderId,
        tag: tag,
        caption: caption ? caption.trim() : null,
        photo_path: photoPath
    };
}

/**
 * 9. Dijital Servis Fişi / Hesap Özeti Kaydet veya Güncelle
 */
function saveServiceReceipt(workOrderId, data) {
    const { labor_cost = 0, items = [], notes = '' } = data;

    const partsCost = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const laborCost = Number(labor_cost) || 0;
    const totalAmount = partsCost + laborCost;
    const itemsJson = JSON.stringify(items);

    const existing = db.prepare('SELECT id FROM service_receipts WHERE work_order_id = ?').get(workOrderId);

    if (existing) {
        const stmt = db.prepare(`
            UPDATE service_receipts 
            SET labor_cost = ?, parts_cost = ?, total_amount = ?, notes = ?, items_json = ?, created_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(laborCost, partsCost, totalAmount, notes ? notes.trim() : null, itemsJson, existing.id);
        return {
            id: existing.id,
            work_order_id: workOrderId,
            labor_cost: laborCost,
            parts_cost: partsCost,
            total_amount: totalAmount,
            notes: notes ? notes.trim() : null,
            items
        };
    } else {
        const stmt = db.prepare(`
            INSERT INTO service_receipts (work_order_id, labor_cost, parts_cost, total_amount, notes, items_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(workOrderId, laborCost, partsCost, totalAmount, notes ? notes.trim() : null, itemsJson);
        return {
            id: Number(result.lastInsertRowid),
            work_order_id: workOrderId,
            labor_cost: laborCost,
            parts_cost: partsCost,
            total_amount: totalAmount,
            notes: notes ? notes.trim() : null,
            items
        };
    }
}

/**
 * 10. İlgili İş Emrinin Dijital Servis Fişini Getir
 */
function getReceiptByWorkOrderId(workOrderId) {
    const row = db.prepare('SELECT * FROM service_receipts WHERE work_order_id = ? ORDER BY id DESC LIMIT 1').get(workOrderId);
    if (!row) return null;
    try {
        row.items = JSON.parse(row.items_json || '[]');
    } catch (e) {
        row.items = [];
    }
    return row;
}

/**
 * 11. Arşivdeki (Teslim Edilmiş) Araçları Getir ve Ara
 */
function getArchiveData(workshopId = 1, searchQuery = '') {
    let sql = `
        SELECT w.*, r.total_amount as invoice_amount, r.id as receipt_id
        FROM work_orders w
        LEFT JOIN service_receipts r ON r.work_order_id = w.id
        WHERE w.workshop_id = ? AND w.status = 'DELIVERED'
    `;
    const params = [workshopId];

    if (searchQuery && searchQuery.trim()) {
        const q = `%${searchQuery.trim().toUpperCase()}%`;
        sql += ` AND (
            UPPER(w.plate) LIKE ? OR 
            UPPER(w.customer_name) LIKE ? OR 
            w.customer_phone LIKE ? OR 
            UPPER(w.car_model) LIKE ?
        )`;
        params.push(q, q, q, q);
    }

    sql += ` ORDER BY w.completed_at DESC, w.updated_at DESC`;

    return db.prepare(sql).all(...params);
}

module.exports = {
    getDashboardData,
    getWorkOrderDetail,
    updateStage,
    createWorkOrder,
    getTrackingDataByPlate,
    createApprovalRequest,
    saveMechanicReply,
    addServicePhoto,
    saveServiceReceipt,
    getReceiptByWorkOrderId,
    getArchiveData
};
