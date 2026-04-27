const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Firebase'i başlat
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

/**
 * FCM - Firebase Cloud Messaging
 * Android uygulamasına push notification gönderir
 */
const sendPushNotification = async (fcm_token, title, body) => {
    if (!fcm_token) return;

    try {
        await admin.messaging().send({
            token: fcm_token,
            notification: {
                title,
                body
            }
        });
        console.log(`[FCM] Bildirim gönderildi → ${title}: ${body}`);
    } catch (error) {
        console.error('[FCM] Bildirim gönderilemedi:', error.message);
    }
};

module.exports = { sendPushNotification };