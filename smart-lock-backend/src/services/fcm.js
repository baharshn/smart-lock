/**
 * FCM - Firebase Cloud Messaging
 *Android uygulamasına push notification gönderir
 */

const sendPushNotification = async (fcm_token, title, body) => {
    if (!fcm_token) return;

    // firebase service account dosyası lazım
    // npm install firebase-admin
    // Buraya gerçek implementasyon gelecek

    console.log(`[FCM STUB] Bildirim gönderildi → ${title}: ${body}`);
};

module.exports = { sendPushNotification };