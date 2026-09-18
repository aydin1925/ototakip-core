const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

// Middlewares
const currentUser = require('./middlewares/currentUser');
const requireAuth = require('./middlewares/requireAuth');

// Rotalar
const indexRoutes = require('./routes/index.routes');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const eventsRoutes = require('./routes/events.routes');
const trackingRoutes = require('./routes/tracking.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine (EJS) ve Layout yapılandırması
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Statik dosyalar (CSS, JS, resimler)
app.use(express.static(path.join(__dirname, 'public')));

// Form gövdesi ayrıştırıcı (POST body)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Oturum (Session) Yapılandırması
app.use(session({
    secret: process.env.SESSION_SECRET || 'ototakip-super-gizli-anahtar-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // Localhost çalıştığımız için false
        maxAge: 1000 * 60 * 60 * 12 // 12 saatlik oturum
    }
}));

// Tüm şablonlara currentUser aktarımı
app.use(currentUser);

// Rotaların Sisteme Bağlanması
app.use('/', indexRoutes);
app.use('/', authRoutes);
app.use('/', trackingRoutes); // Herkese açık canlı müşteri takip rotası
app.use('/', eventsRoutes);
// Dashboard ve Araç detay sayfaları oturum kontrolüyle korunur
app.use('/', requireAuth, dashboardRoutes);

// Sunucuyu başlatan fonksiyon
function startWebServer() {
    app.listen(PORT, () => {
        console.log(`\n🚀 OtoTakip Web Paneli Canlıda: http://localhost:${PORT}`);
    });
}

module.exports = { app, startWebServer };
