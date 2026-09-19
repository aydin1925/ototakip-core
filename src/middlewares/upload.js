// upload.js - Fotoğraf ve servis görseli yükleme ara yazılımı (Multer)
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// uploads klasörünün varlığını garantiye al
const uploadDir = path.resolve(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Disk depolama ayarları
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `service-${uniqueSuffix}${ext}`);
    }
});

// Dosya türü filtresi (sadece görseller)
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        cb(null, true);
    } else {
        cb(new Error('Yalnızca fotoğraf dosyaları (JPG, PNG, WEBP) yüklenebilir!'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Maksimum 10MB
    fileFilter: fileFilter
});

module.exports = upload;
