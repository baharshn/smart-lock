const nodemailer = require('nodemailer');
const supabase = require('../db/supabase');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendAlarmEmail(alarmType, timestamp) {
    try {
        // Tüm aktif admin ve superadminlerin maillerini çek
        const { data: admins, error } = await supabase
            .from('users')
            .select('email')
            .in('role', ['admin', 'super_admin'])
            .eq('is_active', true);

        if (error || !admins || admins.length === 0) {
            console.log('[EMAIL] Alıcı bulunamadı');
            return;
        }

        const recipients = admins.map(u => u.email).join(', ');

        await transporter.sendMail({
            from: `"Smart Lock" <${process.env.EMAIL_USER}>`,
            to: recipients,
            subject: '🚨 Smart Lock - Alarm Bildirimi',
            html: `
        <h2>⚠️ Alarm Tespit Edildi</h2>
        <p><strong>Alarm Türü:</strong> ${alarmType}</p>
        <p><strong>Zaman:</strong> ${new Date(timestamp).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</p>
        <p>Smart Lock sisteminizde şüpheli bir durum tespit edildi.</p>
      `,
        });

        console.log(`[EMAIL] Alarm maili gönderildi → ${recipients}`);
    } catch (err) {
        console.error('[EMAIL] Mail gönderilemedi:', err.message);
    }
}

module.exports = { sendAlarmEmail };