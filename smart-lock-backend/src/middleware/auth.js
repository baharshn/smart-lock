require('dotenv').config();
const jwt = require('jsonwebtoken');

/**
 * JWT token doğrulama - admin ve super_admin için
 * web paneli ve mobil uygulaması her istekte Authorization header'ında Bearer token gönderir
 * Bu middleware token'ın geçerli olup olmadığını ve
 * kullanıcının admin veya super_admin rolünde olup olmadığını kontrol eder
 */
const authenticateAdmin = (req, res, next) => {
    // Header'dan token'ı al (Authorization: Bearer xxxxx)
    const token = req.headers.authorization?.split(' ')[1];

    // Token yoksa isteği reddet
    if (!token)
        return res.status(401).json({ error: 'Token gerekli' });

    try {
        // Token'ı doğrula ve içindeki kullanıcı bilgilerini çöz
        req.user = jwt.verify(token, process.env.JWT_SECRET);

        // Sadece admin ve super_admin erişebilir, normal user erişemez
        if (!['admin', 'super_admin'].includes(req.user.role))
            return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });

        // Token geçerliyse bir sonraki adıma geç
        next();
    } catch {
        res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }
};

/**
 * JWT token doğrulama - sadece super_admin için
 * Admin ekleme/silme, ayarları değiştirme, sistemi sıfırlama gibi
 * kritik işlemler sadece super_admin tarafından yapılabilir
 */
const authenticateSuperAdmin = (req, res, next) => {
    // Header'dan token'ı al
    const token = req.headers.authorization?.split(' ')[1];

    // Token yoksa isteği reddet
    if (!token)
        return res.status(401).json({ error: 'Token gerekli' });

    try {
        // Token'ı doğrula
        req.user = jwt.verify(token, process.env.JWT_SECRET);

        // Sadece super_admin erişebilir
        if (req.user.role !== 'super_admin')
            return res.status(403).json({ error: 'Bu işlem için super admin yetkisi gerekli' });

        next();
    } catch {
        res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }
};

/**
 * Cihaz token doğrulama - sadece firmware için
 * Firmware her istekte x-device-token header'ı gönderir
 * Bu token .env dosyasındaki DEVICE_TOKEN ile karşılaştırılır
 * Web ve mobil bu endpoint'lere erişemez
 */
const authenticateDevice = (req, res, next) => {
    const token = req.headers['x-device-token'];

    // Token eşleşmiyorsa isteği reddet
    if (token !== process.env.DEVICE_TOKEN)
        return res.status(401).json({ error: 'Yetkisiz cihaz' });

    next();
};

// Diğer dosyaların kullanabilmesi için export et
module.exports = { authenticateAdmin, authenticateSuperAdmin, authenticateDevice };