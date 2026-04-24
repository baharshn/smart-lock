const swaggerAutogen = require('swagger-autogen')();

const doc = {
    info: {
        title: 'Smart Lock API',
        description: 'Akıllı Kapı Kilidi Sistemi API Dökümantasyonu'
    },
    host: 'smart-lock-production.up.railway.app',
    schemes: ['https', 'http'],
    securityDefinitions: {
        bearerAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
            description: 'Bearer token gir: Bearer <token>'
        }
    },
    security: [{ bearerAuth: [] }]
};

const outputFile = './swagger-output.json';
const routes = ['./src/app.js'];

swaggerAutogen(outputFile, routes, doc);