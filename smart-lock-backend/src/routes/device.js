const router = require('express').Router();
const supabase = require('../db/supabase');
const { authenticateDevice } = require('../middleware/auth');

/**
 * POST /api/device/access-event
 * Her parmak izi okutma işleminden sonra firmware bu endpoint'i çağırır
 * Başarılı veya başarısız her denemede çağrılır
 * access_logs tablosuna kayıt düşer
 * WebSocket ile web paneline anlık bildirim gönderir
 */
router.post('/access-event', authenticateDevice, async (req, res) => {
    const { fingerprint_slot, success, consecutive_failure_count } = req.body;

    // Gerekli alanlar gönderilmiş mi kontrol et
    if (fingerprint_slot === undefined || success === undefined)
        return res.status(400).json({ error: 'fingerprint_slot ve success gerekli' });

    // Parmak izi slotuna göre kullanıcıyı bul
    // Eşleşme yoksa user_id null olarak kaydedilir
    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('fingerprint_slot', fingerprint_slot)
        .eq('is_active', true)
        .single();

    // Erişim olayını veritabanına kaydet
    const { data: log, error } = await supabase
        .from('access_logs')
        .insert({
            user_id: user?.id || null,        // Kullanıcı bulunamadıysa null
            fingerprint_slot_raw: fingerprint_slot,
            success,
            consecutive_failure_count: consecutive_failure_count || 0
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // WebSocket ile web paneline anlık bildirim gönder
    // Zeynep'in dashboard tablosu otomatik güncellenir
    req.app.get('io')?.emit('new_access_event', log);

    res.json({ log_id: log.id });
});

/**
 * POST /api/device/alarm
 * 5 üst üste başarısız girişte firmware bu endpoint'i çağırır
 * alarms tablosuna kayıt düşer
 * FCM ile İzzet'in telefonuna push notification gönderilir
 */
router.post('/alarm', authenticateDevice, async (req, res) => {
    const { alarm_type, access_log_id } = req.body;

    // alarm_type zorunlu: 'lockout' veya 'forced_entry'
    if (!alarm_type)
        return res.status(400).json({ error: 'alarm_type gerekli' });

    // Alarmı veritabanına kaydet
    const { data: alarm, error } = await supabase
        .from('alarms')
        .insert({
            alarm_type,
            access_log_id: access_log_id || null
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // FCM ile mobil uygulamaya push notification gönder
    // fcm.js servisi henüz yazılmadığı için şimdilik yorum satırı
    // const { sendAlarmNotification } = require('../services/fcm');
    // await sendAlarmNotification(alarm_type, alarm.id);

    // WebSocket ile web paneline anlık bildirim gönder
    req.app.get('io')?.emit('new_alarm', alarm);

    res.json({ alarm_id: alarm.id });
});

/**
 * GET /api/device/pending-command
 * Firmware her 3 saniyede bir bu endpoint'i çağırır
 * Web paneli veya mobil uygulamadan gelen bekleyen komut var mı diye kontrol eder
 * Komut varsa firmware çalıştırır, yoksa null döner
 */
router.get('/pending-command', authenticateDevice, async (req, res) => {
    // Acknowledge edilmemiş en eski komutu getir
    const { data: command } = await supabase
        .from('pending_commands')
        .select('*')
        .eq('acknowledged', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    res.json({ command: command || null });
});

/**
 * PATCH /api/device/pending-command/:id/acknowledge
 * Firmware komutu çalıştırdıktan sonra bu endpoint'i çağırır
 * Komutu acknowledge edildi olarak işaretler
 * Böylece aynı komut tekrar çalıştırılmaz
 */
router.patch('/pending-command/:id/acknowledge', authenticateDevice, async (req, res) => {
    const { error } = await supabase
        .from('pending_commands')
        .update({
            acknowledged: true,
            acknowledged_at: new Date().toISOString()
        })
        .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true });
});

/**
 * GET /api/device/pending-enrollment
 * Firmware enrollment moduna geçtiğinde bu endpoint'i çağırır
 * Web panelinden isim girilmiş ama henüz parmak izi atanmamış
 * kullanıcı var mı kontrol eder
 * Varsa o kullanıcının id'sini döner, firmware parmak izini okutup
 * enroll endpoint'ini çağırır
 */
router.get('/pending-enrollment', authenticateDevice, async (req, res) => {
    // fingerprint_slot'u NULL olan aktif kullanıcıları getir
    // Bunlar web panelinden eklenmiş ama henüz parmak izi okutulmamış kişiler
    const { data: user } = await supabase
        .from('users')
        .select('id, display_name')
        .is('fingerprint_slot', null)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    res.json({ pending_user: user || null });
});

/**
 * POST /api/device/enroll
 * Parmak izi başarıyla okunduktan sonra firmware bu endpoint'i çağırır
 * Kullanıcıya fingerprint_slot atar ve kaydı tamamlar
 */
router.post('/enroll', authenticateDevice, async (req, res) => {
    const { user_id, fingerprint_slot } = req.body;

    // Her iki alan da zorunlu
    if (!user_id || fingerprint_slot === undefined)
        return res.status(400).json({ error: 'user_id ve fingerprint_slot gerekli' });

    // Bu slot daha önce kullanılmış mı kontrol et
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('fingerprint_slot', fingerprint_slot)
        .single();

    if (existingUser)
        return res.status(400).json({ error: 'Bu slot zaten kullanımda' });

    // Kullanıcıya fingerprint_slot ata
    const { data: user, error } = await supabase
        .from('users')
        .update({ fingerprint_slot })
        .eq('id', user_id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ user });
});

module.exports = router;