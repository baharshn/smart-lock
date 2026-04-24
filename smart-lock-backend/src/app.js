require('dotenv').config();
const swaggerUi = require('swagger-ui-express');

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// HTTP sunucusu oluştur
// Normal express app yerine http.createServer kullanıyoruz
// çünkü WebSocket için http sunucusuna ihtiyaç var
const server = http.createServer(app);

/**
 * WebSocket sunucusu
 * web paneli buraya bağlanır
 * Yeni log veya alarm geldiğinde otomatik bildirim gönderilir
 * cors: * → geliştirme aşamasında her yerden bağlanabilsin
 */
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// io nesnesini app'e ekle
// Route dosyaları req.app.get('io') ile erişebilir
app.set('io', io);

// Swagger
const swaggerOutput = require('../swagger-output.json');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerOutput));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/alarms', require('./routes/alarms'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/commands', require('./routes/commands'));
app.use('/api/device', require('./routes/device'));

/**
 * WebSocket bağlantı olayları
 * web paneli bağlandığında ve ayrıldığında log basılır
 */
io.on('connection', (socket) => {
    console.log('Web paneli bağlandı:', socket.id);

    socket.on('disconnect', () => {
        console.log('Web paneli ayrıldı:', socket.id);
    });
});

// Test endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Smart Lock Backend çalışıyor' });
});

// app.listen yerine server.listen kullanıyoruz
// WebSocket için http sunucusunu başlatmak gerekiyor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});

module.exports = app;