const authService = require('../services/authService');

/**
 * 1. Giriş Sayfasını Göster (GET /login)
 */
function showLoginForm(req, res) {
    // Usta zaten giriş yapmışsa tekrar login sayfasını gösterme, doğrudan panele gönder
    if (req.session && req.session.workshopId) {
        return res.redirect('/dashboard');
    }

    res.render('auth/login', {
        title: 'Usta Girişi',
        error: null,
        formData: {}
    });
}

/**
 * 2. Giriş İşlemini Gerçekleştir (POST /login)
 */
function login(req, res) {
    try {
        const { identifier, password } = req.body;
        
        // Servis katmanında şifre ve telefon doğrulaması yap
        const workshop = authService.login(identifier, password);

        // Doğrulama başarılı! Session'a atölye bilgilerini mühürle
        req.session.workshopId = workshop.id;
        req.session.workshop = workshop;

        // Ustayı doğrudan lift paneline yönlendir
        res.redirect('/dashboard');
    } catch (err) {
        // Hata durumunda formu kullanıcının yazdığı numarayla birlikte geri göster
        res.status(400).render('auth/login', {
            title: 'Usta Girişi',
            error: err.message,
            formData: { identifier: req.body.identifier }
        });
    }
}

/**
 * 3. Kayıt Sayfasını Göster (GET /register)
 */
function showRegisterForm(req, res) {
    if (req.session && req.session.workshopId) {
        return res.redirect('/dashboard');
    }

    res.render('auth/register', {
        title: 'Servis Kaydı',
        error: null,
        formData: {}
    });
}

/**
 * 4. Kayıt İşlemini Gerçekleştir (POST /register)
 */
function register(req, res) {
    try {
        // Servis katmanında yeni atölyeyi veritabanına kaydet
        const workshop = authService.register(req.body);

        // Kayıt olur olmaz ustayı otomatik olarak sisteme giriş yaptır
        req.session.workshopId = workshop.id;
        req.session.workshop = workshop;

        res.redirect('/dashboard');
    } catch (err) {
        res.status(400).render('auth/register', {
            title: 'Servis Kaydı',
            error: err.message,
            formData: req.body
        });
    }
}

/**
 * 5. Çıkış Yap (GET /logout)
 */
function logout(req, res) {
    // 1. Sunucudaki session oturumunu imha et
    req.session.destroy((err) => {
        if (err) {
            console.error('Session sonlandırma hatası:', err);
        }
        // 2. Tarayıcıdaki oturum çerezini (cookie) temizle
        res.clearCookie('connect.sid');
        // 3. Giriş sayfasına postala
        res.redirect('/login');
    });
}

module.exports = {
    showLoginForm,
    login,
    showRegisterForm,
    register,
    logout
};
