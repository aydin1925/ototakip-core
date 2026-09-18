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
                WHEN status = 'REPAIRING' THEN 2
                WHEN status = 'RECEIVED' THEN 3
                WHEN status = 'READY' THEN 4
                ELSE 5
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
        SELECT * FROM service_photos 
        WHERE work_order_id = ? 
        ORDER BY created_at DESC
    `).all(workOrderId);

    // Bu araca ait müşteri-usta mesajlaşma geçmişi
    const messages = db.prepare(`
        SELECT * FROM customer_messages 
        WHERE work_order_id = ? 
        ORDER BY created_at ASC
    `).all(workOrderId);

    return {
        ...workOrder,
        approvals,
        photos,
        messages
    };
}
/**
 * 3. Araç Aşamasını Güncelle (Kabul -> Teşhis -> Onarım -> Hazır -> Teslim Edildi)
 */
function updateStage(workOrderId, newStatus, workshopId = 1) {
    const validStatuses = ['RECEIVED', 'INSPECTING', 'REPAIRING', 'READY', 'DELIVERED'];
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
    const stmt = db.prepare(`
        UPDATE work_orders 
        SET status = ?, updated_at = ?
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

    return {
        ...workOrder,
        approvals
    };
}

/**
 * 6. Yeni Parça Onay Talebi Aç
 */
function createApprovalRequest(workOrderId, partName, note) {
    if (!workOrderId || !partName) {
        throw new Error('İş emri ve parça adı zorunludur.');
    }

    const stmt = db.prepare(`
        INSERT INTO approval_requests (work_order_id, part_name, note, status)
        VALUES (?, ?, ?, 'PENDING')
    `);

    const result = stmt.run(workOrderId, partName.trim(), note ? note.trim() : null);

    return {
        id: Number(result.lastInsertRowid),
        work_order_id: workOrderId,
        part_name: partName.trim(),
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

module.exports = {
    getDashboardData,
    getWorkOrderDetail,
    updateStage,
    createWorkOrder,
    getTrackingDataByPlate,
    createApprovalRequest,
    saveMechanicReply
};
