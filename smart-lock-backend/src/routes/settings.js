const router = require('express').Router();
const supabase = require('../db/supabase');
const { authenticateAdmin, authenticateSuperAdmin } = require('../middleware/auth');

/**
 * GET /api/settings
 * Tüm sistem ayarlarını getirir
 * Zeynep'in ayarlar sayfası bu endpoint'i kullanır
 * Hem admin hem super_admin görebilir
 *
 * Dönen ayarlar:
 * lockout_threshold         → kaç başarısız denemede alarm (varsayılan 5)
 * unlock_duration_seconds   → kilit kaç saniye açık kalsın (varsayılan 5)
 * alarm_enabled             → alarm aktif mi pasif mi (varsayılan true)
 */
router.get('/', authenticateAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('settings')
        .select('*')
        .order('key', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Ayarları key-value objesi olarak döndür
    // [{ key: 'lockout_threshold', value: '5' }] yerine
    // { lockout_threshold: '5' } formatında döndür
    // Zeynep ve İzzet için kullanımı daha kolay
    const settings = {};
    data.forEach(setting => {
        settings[setting.key] = setting.value;
    });

    res.json(settings);
});

/**
 * PATCH /api/settings
 * Sistem ayarlarını günceller
 * Sadece super_admin yapabilir
 * Firmware bir sonraki polling'de güncel ayarları alır
 *
 * Body örneği:
 * { "lockout_threshold": "3", "unlock_duration_seconds": "10" }
 */
router.patch('/', authenticateSuperAdmin, async (req, res) => {
    const allowedKeys = ['lockout_threshold', 'unlock_duration_seconds', 'alarm_enabled'];
    const updates = req.body;

    // Gönderilen ayarlar geçerli mi kontrol et
    const invalidKeys = Object.keys(updates).filter(key => !allowedKeys.includes(key));
    if (invalidKeys.length > 0)
        return res.status(400).json({ error: `Geçersiz ayar anahtarları: ${invalidKeys.join(', ')}` });

    // Hiç ayar gönderilmemiş mi kontrol et
    if (Object.keys(updates).length === 0)
        return res.status(400).json({ error: 'Güncellenecek ayar gerekli' });

    // Her ayarı tek tek güncelle
    // upsert: kayıt varsa güncelle, yoksa ekle
    const updatePromises = Object.entries(updates).map(([key, value]) =>
        supabase
            .from('settings')
            .upsert({
                key,
                value: String(value),  // Her zaman string olarak sakla
                updated_at: new Date().toISOString(),
                updated_by: req.user.id
            })
    );

    await Promise.all(updatePromises);

    // Güncel ayarları getir ve döndür
    const { data, error } = await supabase
        .from('settings')
        .select('*');

    if (error) return res.status(500).json({ error: error.message });

    // key-value objesi olarak döndür
    const settings = {};
    data.forEach(setting => {
        settings[setting.key] = setting.value;
    });

    res.json(settings);
});

module.exports = router;