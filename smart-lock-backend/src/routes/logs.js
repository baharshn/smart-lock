const router = require('express').Router();
const supabase = require('../db/supabase');
const { authenticateAdmin } = require('../middleware/auth');

/**
 * GET /api/logs
 * Erişim loglarını listeler
 * web dashboard tablosu ve log sayfası bu endpoint'i kullanır
 * mobil uygulaması ana ekrandaki son 10 kaydı buradan çeker
 * Hem admin hem super_admin görebilir
 *
 * Query parametreleri ile filtreleme yapılabilir:
 * ?success=true/false       → başarılı veya başarısız girişler
 * ?user_id=uuid             → belirli bir kullanıcının logları
 * ?start_date=2026-01-01    → başlangıç tarihi
 * ?end_date=2026-12-31      → bitiş tarihi
 * ?limit=10                 → kaç kayıt gelsin (varsayılan 50)
 */
router.get('/', authenticateAdmin, async (req, res) => {
    const { success, user_id, start_date, end_date, limit } = req.query;

    // users tablosundan display_name çekilir logda kimin girdiği de görünsün diye
    let query = supabase
        .from('access_logs')
        .select(`
            *,
            users (
                id,
                display_name,
                role
            )
        `)
        .order('created_at', { ascending: false })
        .limit(limit ? parseInt(limit) : 50);

    // Başarılı/başarısız filtresi
    // ?success=true veya ?success=false
    if (success !== undefined)
        query = query.eq('success', success === 'true');

    // Belirli kullanıcının logları
    // ?user_id=uuid
    if (user_id)
        query = query.eq('user_id', user_id);

    // Tarih aralığı filtresi
    // ?start_date=2026-01-01
    if (start_date)
        query = query.gte('created_at', start_date);

    // ?end_date=2026-12-31
    if (end_date)
        query = query.lte('created_at', end_date);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
});

/**
 * GET /api/logs/export
 * Logları CSV formatında indirir
 * logları dosya olarak indirmek istersek diye koydum
 * Aynı filtreler burada da geçerli
 * Hem admin hem super_admin export edebilir
 */
router.get('/export', authenticateAdmin, async (req, res) => {
    const { success, user_id, start_date, end_date } = req.query;

    // Temel sorguyu oluştur
    let query = supabase
        .from('access_logs')
        .select(`
            *,
            users (
                display_name
            )
        `)
        .order('created_at', { ascending: false });

    // Filtreleri uygula
    if (success !== undefined)
        query = query.eq('success', success === 'true');
    if (user_id)
        query = query.eq('user_id', user_id);
    if (start_date)
        query = query.gte('created_at', start_date);
    if (end_date)
        query = query.lte('created_at', end_date);

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    // CSV formatına çevir
    const csvRows = [];

    csvRows.push(['Tarih', 'Kullanıcı', 'Başarılı', 'Başarısız Deneme Sayısı', 'Kapı'].join(','));

    // Veri
    data.forEach(log => {
        csvRows.push([
            new Date(log.created_at).toLocaleString('tr-TR'),
            log.users?.display_name || 'Bilinmeyen',
            log.success ? 'Evet' : 'Hayır',
            log.consecutive_failure_count,
            log.door_id
        ].join(','));
    });

    const csvContent = csvRows.join('\n');

    // Tarayıcıya CSV dosyası olarak gönder
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=erisim-loglari.csv');
    res.send(csvContent);
});

module.exports = router;