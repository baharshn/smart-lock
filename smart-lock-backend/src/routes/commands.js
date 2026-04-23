const router = require('express').Router();
const supabase = require('../db/supabase');
const { authenticateAdmin } = require('../middleware/auth');

/**
 * POST /api/commands
 * Uzaktan kilit açma veya kilitleme komutu oluşturur
 * web paneli veya mobil uygulaması bu endpoint'i çağırır
 * Komut pending_commands tablosuna yazılır
 * Firmware 3 saniyede bir bu tabloyu kontrol edip komutu çalıştırır
 * Hem admin hem super_admin kullanabilir
 */
router.post('/', authenticateAdmin, async (req, res) => {
    const { command_type } = req.body;

    // command_type zorunlu ve sadece 'lock' veya 'unlock' olabilir
    if (!command_type || !['lock', 'unlock'].includes(command_type))
        return res.status(400).json({ error: "command_type 'lock' veya 'unlock' olmalı" });

    // Komutu veritabanına kaydet
    // acknowledged: false → firmware henüz çalıştırmadı
    const { data: command, error } = await supabase
        .from('pending_commands')
        .insert({
            command_type,
            payload: {
                // Komutu kimin gönderdiğini kaydet
                sent_by: req.user.id,
                sent_by_role: req.user.role
            },
            acknowledged: false
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ command });
});

/**
 * GET /api/commands
 * Geçmiş komutları listeler
 * Hem admin hem super_admin görebilir
 * acknowledge edilmiş ve edilmemiş tüm komutlar listelenir
 */
router.get('/', authenticateAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('pending_commands')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
});

module.exports = router;