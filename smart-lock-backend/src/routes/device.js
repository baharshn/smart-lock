const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const upload = multer({ storage: multer.memoryStorage() });
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

    // Erişimin veritabanına kayıt
    const { data: log, error } = await supabase
        .from('access_logs')
        .insert({
            user_id: user?.id || null,
            fingerprint_slot_raw: fingerprint_slot,
            success,
            consecutive_failure_count: consecutive_failure_count || 0
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // WebSocket ile web paneline anlık bildirim gönder
    req.app.get('io')?.emit('new_access_event', log);

    // Başarısız girişte admin/super_admin'lere bildirim gönder
    if (!success) {
        const { sendPushNotification } = require('../services/fcm');
        const { data: admins } = await supabase
            .from('users')
            .select('fcm_token')
            .in('role', ['admin', 'super_admin'])
            .eq('is_active', true)
            .not('fcm_token', 'is', null);

        if (admins && admins.length > 0) {
            for (const adminUser of admins) {
                await sendPushNotification(adminUser.fcm_token, 'Başarısız Giriş!', 'Kapıya yetkisiz giriş denemesi yapıldı');
            }
        }
    }

    res.json({ log_id: log.id });
});

/**
 * POST /api/device/alarm
 * 5 üst üste başarısız girişte firmware bu endpoint'i çağırır
 * alarms tablosuna kayıt düşer
 * FCM ile mobile push notification gönderilir
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

    const { sendPushNotification } = require('../services/fcm');

// admin ve super_admin rolündeki tüm kullanıcılara bildirim gönder
    const { data: admins } = await supabase
        .from('users')
        .select('fcm_token')
        .in('role', ['admin', 'super_admin'])
        .eq('is_active', true)
        .not('fcm_token', 'is', null);

    if (admins && admins.length > 0) {
        for (const admin of admins) {
            await sendPushNotification(admin.fcm_token, 'Alarm!', `${alarm_type} tespit edildi`);
        }
    }
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
    const { data: updatedCommands, error } = await supabase
        .from('pending_commands')
        .update({
            acknowledged: true,
            acknowledged_at: new Date().toISOString()
        })
        .eq('id', req.params.id)
        .select();

    if (error) return res.status(500).json({ error: error.message });

    const command = updatedCommands[0];
    req.app.get('io')?.emit('command_acknowledged', {
        command_id: req.params.id,
        command_type: command?.command_type
    });

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


router.post('/access-event/:logId/photo', authenticateDevice, async (req, res) => {
    const { logId } = req.params;

    // log kaydı var mı ve başarısız mı kontrol et
    const { data: log, error: logError } = await supabase
        .from('access_logs')
        .select('id, success')
        .eq('id', logId)
        .single();

    if (logError || !log) {
        return res.status(404).json({ error: 'Log kaydı bulunamadı' });
    }

    if (log.success === true) {
        return res.status(400).json({ error: 'Başarılı girişlere fotoğraf eklenemez' });
    }

    // gelen binary veriyi buffer'a topla
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
        try {
            const buffer = Buffer.concat(chunks);
            const fileName = `${logId}_${uuidv4()}.jpg`;

            const { error: uploadError } = await supabase.storage
                .from('access-photos')
                .upload(fileName, buffer, {
                    contentType: 'image/jpeg',
                    upsert: false
                });

            if (uploadError) {
                return res.status(500).json({ error: 'Fotoğraf yüklenemedi', detail: uploadError.message });
            }

            const { data: urlData } = supabase.storage
                .from('access-photos')
                .getPublicUrl(fileName);

            const photoUrl = urlData.publicUrl;

            const { error: updateError } = await supabase
                .from('access_logs')
                .update({ photo_url: photoUrl })
                .eq('id', logId);

            if (updateError) {
                return res.status(500).json({ error: 'Log güncellenemedi', detail: updateError.message });
            }

            return res.status(201).json({ message: 'Fotoğraf başarıyla yüklendi', photo_url: photoUrl });

        } catch (err) {
            return res.status(500).json({ error: 'Sunucu hatası', detail: err.message });
        }
    });
});

module.exports = router;