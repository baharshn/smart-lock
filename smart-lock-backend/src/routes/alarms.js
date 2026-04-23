const router = require('express').Router();
const supabase = require('../db/supabase');
const { authenticateAdmin } = require('../middleware/auth');

/**
 * GET /api/alarms
 * Alarm listesini getirir
 * Zeynep'in alarm sayfası ve İzzet'in alarmlar sekmesi bu endpoint'i kullanır
 * Hem admin hem super_admin görebilir
 *
 * Query parametreleri:
 * ?resolved=true/false → çözülmüş veya çözülmemiş alarmlar
 */
router.get('/', authenticateAdmin, async (req, res) => {
    const { resolved } = req.query;

    // Temel sorguyu oluştur
    // İlgili access_log kaydını da çek, hangi girişten tetiklendiği görünsün
    let query = supabase
        .from('alarms')
        .select(`
            *,
            access_logs (
                id,
                fingerprint_slot_raw,
                consecutive_failure_count,
                created_at,
                users (
                    display_name
                )
            )
        `)
        .order('triggered_at', { ascending: false });

    // Çözülmüş/çözülmemiş filtresi
    // ?resolved=false → sadece aktif alarmlar
    if (resolved !== undefined)
        query = query.eq('resolved', resolved === 'true');

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
});

/**
 * PATCH /api/alarms/:id/resolve
 * Alarmı çözüldü olarak işaretler
 * Zeynep veya İzzet "Çözüldü" butonuna basınca bu endpoint çağrılır
 * Hem admin hem super_admin çözebilir
 */
router.patch('/:id/resolve', authenticateAdmin, async (req, res) => {
    // Alarm var mı kontrol et
    const { data: alarm, error: findError } = await supabase
        .from('alarms')
        .select('id, resolved')
        .eq('id', req.params.id)
        .single();

    if (findError || !alarm)
        return res.status(404).json({ error: 'Alarm bulunamadı' });

    // Zaten çözülmüş mü kontrol et
    if (alarm.resolved)
        return res.status(400).json({ error: 'Bu alarm zaten çözülmüş' });

    // Alarmı çözüldü olarak işaretle
    const { data: updatedAlarm, error } = await supabase
        .from('alarms')
        .update({ resolved: true })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // WebSocket ile web paneline anlık bildirim gönder
    // Alarm listesi otomatik güncellenir
    req.app.get('io')?.emit('alarm_resolved', updatedAlarm);

    res.json({ alarm: updatedAlarm });
});

module.exports = router;