const router = require('express').Router();
const supabase = require('../db/supabase');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { authenticateAdmin } = require('../middleware/auth');

require('dotenv').config();



/**
 * POST /api/auth/login
 * Email ve şifre ile giriş yapma endpoint'i
 * Başarılı girişte JWT token döner
 * Bu token sonraki tüm isteklerde Authorization header'ında kullanılır
 * Sadece admin ve super_admin giriş yapabilir, normal user yapamaz
 */
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Email ve şifre gönderilmiş mi kontrol et
    if (!email || !password)
        return res.status(400).json({ error: 'Email ve şifre gerekli' });

    // Kullanıcıyı emaile göre bul
    // Sadece aktif kullanıcılar giriş yapabilir
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .single();

    // Kullanıcı bulunamadıysa genel hata mesajı dön
    // "Email bulunamadı" yerine "Email veya şifre hatalı" diyoruz
    // çünkü hangisinin yanlış olduğunu söylemek güvenlik açığı oluşturur
    if (error || !user)
        return res.status(401).json({ error: 'Email veya şifre hatalı' });

    // Normal user rolündeki kişiler sisteme giriş yapamaz
    // Onlar sadece parmak iziyle kapıdan geçebilir
    if (user.role === 'user')
        return res.status(403).json({ error: 'Erişim yetkiniz yok' });

    // Gönderilen şifre ile veritabanındaki hash'i karşılaştır
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch)
        return res.status(401).json({ error: 'Email veya şifre hatalı' });

    //token üretme işlemi
    // Access token - 3 saatlik, API isteklerinde kullanılır
    const accessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '3h' }
    );

// Refresh token - 7 günlük, sadece yeni accessToken almak için kullanılır
    const refreshToken = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );

// Refresh token'ı database'e kaydet
    await supabase
        .from('users')
        .update({
            refresh_token: refreshToken,
            refresh_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
        .eq('id', user.id);

    res.json({
        accessToken,
        refreshToken,
        user: {
            id: user.id,
            email: user.email,
            display_name: user.display_name,
            role: user.role
        }
    });
});



/**
 * PATCH /api/auth/change-password
 * Şifre değiştirme endpoint'i
 * Giriş yapmış kullanıcı eski şifresini ve yeni şifresini gönderir
 * Super admin tarafından oluşturulan adminler ilk girişte
 * geçici şifrelerini bu endpoint ile değiştirir
 * Token gerektirir - giriş yapmamış kişi şifre değiştiremez
 */
router.patch('/change-password', authenticateAdmin, async (req, res) => {
    const { old_password, new_password } = req.body;

    // Her iki şifre de gönderilmiş mi kontrol et
    if (!old_password || !new_password)
        return res.status(400).json({ error: 'Eski ve yeni şifre gerekli' });

    // Yeni şifre en az 6 karakter olmalı
    if (new_password.length < 6)
        return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı' });

    // Token'dan gelen id ile kullanıcıyı bul
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.user.id)
        .single();

    if (error || !user)
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Eski şifre doğru mu kontrol et
    const passwordMatch = await bcrypt.compare(old_password, user.password_hash);
    if (!passwordMatch)
        return res.status(401).json({ error: 'Eski şifre hatalı' });

    // Yeni şifreyi hashle ve güncelle
    const password_hash = await bcrypt.hash(new_password, 10);
    await supabase
        .from('users')
        .update({ password_hash })
        .eq('id', req.user.id);

    res.json({ message: 'Şifre başarıyla güncellendi' });
});


//refresh işlemi hen accessToken hem refreshToken gelşyor
router.post('/refresh', async (req, res) => {
    const { accessToken, refreshToken } = req.body;

    if (!accessToken || !refreshToken)
        return res.status(400).json({ error: 'accessToken ve refreshToken gerekli' });


    let decoded;
    try {
        decoded = jwt.verify(accessToken, process.env.JWT_SECRET, { ignoreExpiration: true });
    } catch {
        return res.status(401).json({ error: 'Geçersiz access token' });
    }

    // O kullanıcının database'deki refresh token ile karşılaştır
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.id)
        .eq('refresh_token', refreshToken)
        .eq('is_active', true)
        .single();

    if (error || !user)
        return res.status(401).json({ error: 'Geçersiz refresh token' });

    if (user.role === 'user')
        return res.status(403).json({ error: 'Erişim yetkiniz yok' });

    if (new Date() > new Date(user.refresh_token_expires_at))
        return res.status(401).json({ error: 'Refresh token süresi dolmuş, tekrar giriş yapın' });

    const newAccessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '3h' }
    );

    res.json({ accessToken: newAccessToken });
});
module.exports = router;