// upload.js - Fotoğraf ve servis görseli yükleme ara yazılımı (Multer + Sharp WebP Optimizasyonu)
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// uploads klasörünün varlığını garantiye al
const uploadDir = path.resolve(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Bellek depolama (RAM üzerinden işlenir, diske doğrudan optimize .webp yazılır)
const memoryStorage = multer.memoryStorage();

// Dosya türü filtresi (tüm popüler görsel formatları desteklenir)
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|heic|heif|avif|bmp|tiff/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /image\/(jpeg|jpg|png|webp|heic|heif|avif|bmp|tiff)/.test(file.mimetype);

    if (extname || mimetype) {
        cb(null, true);
    } else {
        cb(new Error('Yalnızca fotoğraf dosyaları (JPG, PNG, WEBP, HEIC) yüklenebilir!'));
    }
};

const multerInstance = multer({
    storage: memoryStorage,
    limits: { fileSize: 25 * 1024 * 1024 }, // Maksimum 25MB ham telefon görseli kabul edilir
    fileFilter: fileFilter
});

/**
 * Sisteme yüklenen fotoğrafı otomatik olarak .webp formatına dönüştürür ve optimize eder.
 * Sunucu disk hafızasının şişmesini ve gereksiz bant genişliği tüketimini önler.
 */
async function processAndConvertToWebp(req, res, next) {
    if (!req.file || !req.file.buffer) {
        return next();
    }

    try {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const webpFilename = `service-${uniqueSuffix}.webp`;
        const webpPath = path.join(uploadDir, webpFilename);

        // Sharp ile görseli dönüştür, EXIF oryantasyonunu koru, makul sınırlara ölçekle ve .webp kaydet
        await sharp(req.file.buffer)
            .rotate() // Akıllı telefon çekimlerindeki EXIF yönünü otomatik düzeltir
            .resize({
                width: 1920,
                height: 1080,
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({
                quality: 80,
                effort: 4 // Dengeli CPU ve sıkıştırma oranı
            })
            .toFile(webpPath);

        // Controller ve Service katmanlarıyla tam geriye dönük uyumluluk
        req.file.filename = webpFilename;
        req.file.path = webpPath;
        req.file.destination = uploadDir;
        req.file.mimetype = 'image/webp';
        
        // RAM'i derhal serbest bırak
        delete req.file.buffer;

        next();
    } catch (error) {
        console.error('WebP dönüştürme hatası:', error);
        next(new Error('Fotoğraf işlenirken ve WebP formatına dönüştürülürken bir hata oluştu: ' + error.message));
    }
}

/**
 * Bağımsız görsel dosyalarını veya tamponları (buffer) .webp formatına dönüştürme fonksiyonu
 * @param {string|Buffer} inputPathOrBuffer - Giriş dosya yolu veya buffer
 * @param {string} outputPath - Çıkış .webp dosya yolu
 * @param {object} options - Opsiyonel kalite ve boyutlandırma parametreleri
 */
async function convertFileToWebp(inputPathOrBuffer, outputPath, options = {}) {
    const quality = options.quality || 80;
    const maxWidth = options.maxWidth || 1920;
    const maxHeight = options.maxHeight || 1080;

    return await sharp(inputPathOrBuffer)
        .rotate()
        .resize({
            width: maxWidth,
            height: maxHeight,
            fit: 'inside',
            withoutEnlargement: true
        })
        .webp({ quality })
        .toFile(outputPath);
}

// Express route'larında upload.single('photo') ve upload.array(...) kullanımını doğrudan destekleyen yapı
const upload = {
    single: (fieldName) => [multerInstance.single(fieldName), processAndConvertToWebp],
    array: (fieldName, maxCount) => [
        multerInstance.array(fieldName, maxCount),
        async (req, res, next) => {
            if (!req.files || !req.files.length) return next();
            try {
                for (const file of req.files) {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                    const webpFilename = `service-${uniqueSuffix}.webp`;
                    const webpPath = path.join(uploadDir, webpFilename);

                    await sharp(file.buffer)
                        .rotate()
                        .resize({ width: 1920, height: 1080, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80, effort: 4 })
                        .toFile(webpPath);

                    file.filename = webpFilename;
                    file.path = webpPath;
                    file.destination = uploadDir;
                    file.mimetype = 'image/webp';
                    delete file.buffer;
                }
                next();
            } catch (err) {
                console.error('Toplu WebP dönüştürme hatası:', err);
                next(err);
            }
        }
    ],
    convertFileToWebp,
    processAndConvertToWebp
};

module.exports = upload;
