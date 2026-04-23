const router = require('express').Router();
const supabase = require('../db/supabase');
const bcrypt = require('bcrypt');
const { authenticateAdmin, authenticateSuperAdmin } = require('../middleware/auth');

/**
 * GET /api/users
 * Tüm aktif kullanıcıları listeler
 * Zeynep'in kullanıcı yönetimi sayfası bu endpoint'i kullanır
 * Hem admin hem super_admin görebilir
 */
router.get('/', authenticateAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('users')
        .select('id, display_name, email, role, fingerprint_slot, is_active, created_at, phone')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
});

/**
 * POST /api/users
 * Yeni normal kullanıcı ekler
 * Web paneli veya mobil uygulamadan isim girilir
 * fingerprint_slot başlangıçta boş kalır
 * Kişi cihaza gidip parmak izini okutunca slot atanır
 * Hem admin hem super_admin ekleyebilir
 */
router.post('/', authenticateAdmin, async (req, res) => {
    const { display_name, phone } = req.body;

    // İsim zorunlu
    if (!display_name)
        return res.status(400).json({ error: 'İsim gerekli' });

    // Kullanıcıyı fingerprint_slot olmadan ekle
    // slot cihazda parmak izi okutulunca device/enroll endpoint'i ile atanacak
    const { data: user, error } = await supabase
        .from('users')
        .insert({
            display_name,
            phone: phone || null,
            role: 'user',
            is_active: true
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ user });
});

/**
 * POST /api/users/create-admin
 * Yeni admin oluşturur
 * Sadece super_admin yapabilir
 * Otomatik geçici şifre üretir ve ekranda gösterir
 * Admin ilk girişte bu geçici şifreyle giriş yapıp şifresini değiştirir
 */
router.post('/create-admin', authenticateSuperAdmin, async (req, res) => {
    const { display_name, email, phone, role } = req.body;

    // İsim ve email zorunlu
    if (!display_name || !email)
        return res.status(400).json({ error: 'İsim ve email gerekli' });

    // Rol sadece 'admin' veya 'super_admin' olabilir
    if (!role || !['admin', 'super_admin'].includes(role))
        return res.status(400).json({ error: "Rol 'admin' veya 'super_admin' olmalı" });

    // Bu email daha önce kullanılmış mı kontrol et
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

    if (existingUser)
        return res.status(400).json({ error: 'Bu email zaten kullanımda' });

    // Rastgele geçici şifre üret
    // Büyük harf, küçük harf ve rakamlardan oluşur
    const temporaryPassword = Math.random().toString(36).slice(-8) +
        Math.random().toString(36).toUpperCase().slice(-4);

    // Geçici şifreyi hashle
    const password_hash = await bcrypt.hash(temporaryPassword, 10);

    // Admini veritabanına ekle
    const { data: user, error } = await supabase
        .from('users')
        .insert({
            display_name,
            email,
            phone: phone || null,
            password_hash,
            role,
            is_active: true
        })
        .select('id, display_name, email, role, created_at')
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // Geçici şifreyi response'da döndür
    // Web paneli bunu ekranda gösterir
    // Bu şifre bir daha gösterilmeyecek, super_admin not almalı
    res.status(201).json({
        user,
        temporary_password: temporaryPassword,
        message: 'Bu geçici şifreyi not alın, bir daha gösterilmeyecek'
    });
});

/**
 * PATCH /api/users/:id
 * Kullanıcı bilgilerini günceller
 * İsim, telefon güncellemesi admin ve super_admin yapabilir
 * Rol değiştirme sadece super_admin yapabilir
 */
router.patch('/:id', authenticateAdmin, async (req, res) => {
    const { display_name, phone, role } = req.body;

    // Rol değiştirme sadece super_admin yapabilir
    if (role && req.user.role !== 'super_admin')
        return res.status(403).json({ error: 'Rol değiştirmek için super admin yetkisi gerekli' });

    // Rol geçerli mi kontrol et
    if (role && !['admin', 'super_admin', 'user'].includes(role))
        return res.status(400).json({ error: 'Geçersiz rol' });

    // Güncellenecek alanları belirle
    const updates = {};
    if (display_name) updates.display_name = display_name;
    if (phone) updates.phone = phone;
    if (role) updates.role = role;

    // Hiçbir alan gönderilmemişse hata dön
    if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: 'Güncellenecek alan gerekli' });

    const { data: user, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ user });
});

/**
 * DELETE /api/users/:id
 * Kullanıcıyı soft delete yapar (is_active = false)
 * Gerçekten silmiyoruz, log kayıtları için referans kalsın diye
 * Eğer parmak izi slotu varsa firmware'e silme komutu gönderir
 * Hem admin hem super_admin silebilir
 */
router.delete('/:id', authenticateAdmin, async (req, res) => {
    // Kullanıcıyı bul
    const { data: user, error: findError } = await supabase
        .from('users')
        .select('fingerprint_slot, role')
        .eq('id', req.params.id)
        .single();

    if (findError || !user)
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    // Admin başka bir admini silemez, sadece super_admin silebilir
    if (['admin', 'super_admin'].includes(user.role) && req.user.role !== 'super_admin')
        return res.status(403).json({ error: 'Admin silmek için super admin yetkisi gerekli' });

    // Soft delete - kullanıcıyı pasif yap
    await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', req.params.id);

    // Parmak izi slotu varsa firmware'e silme komutu gönder
    // Firmware bu komutu alınca R307 sensöründen template'i siler
    if (user.fingerprint_slot !== null) {
        await supabase
            .from('pending_commands')
            .insert({
                command_type: 'config_update',
                payload: {
                    action: 'delete_template',
                    fingerprint_slot: user.fingerprint_slot
                },
                acknowledged: false
            });
    }

    res.json({ ok: true });
});

module.exports = router;