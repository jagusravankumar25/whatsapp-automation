const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let latestQrData = null;
let isClientReady = false;

// Cloud Config: Configured for Render Linux Environments with automatic cache target mappings
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/opt/render/project/src/.wwebjs_auth' // Persistent path for Render filesystem
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://githubusercontent.com{version}.html',
        strict: false
    }
});

// WhatsApp State Handling
client.on('qr', (qr) => {
    console.log('New QR Code generated. Visit your /qr endpoint in a browser to scan.');
    latestQrData = qr;
});

client.on('ready', () => {
    console.log('🚀 WhatsApp Engine linked and active!');
    isClientReady = true;
    latestQrData = null;
});

client.on('disconnected', () => {
    console.log('🔌 Client logged out.');
    isClientReady = false;
});

// SERVICE 1: CONNECTING (Displays the QR Code in your Web Browser)
app.get('/qr', async (req, res) => {
    if (isClientReady) {
        return res.send('<h1>Status: Connected!</h1><p>Your WhatsApp account is active.</p>');
    }
    if (!latestQrData) {
        return res.send('<h1>Initializing...</h1><p>Please refresh this page in a few seconds while the engine mounts.</p>');
    }

    try {
        const qrImagePage = await QRCode.toDataURL(latestQrData);
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: Arial, sans-serif;">
                <h2>Scan this QR Code with WhatsApp:</h2>
                <img src="${qrImagePage}" style="border: 1px solid #ccc; padding: 10px; border-radius: 5px;"/>
                <p style="color: #666; margin-top: 15px;">Refresh the page if your registration times out.</p>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error rendering interface.');
    }
});

// SERVICE 2: SENDING THE MESSAGE
app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;

    if (!isClientReady) {
        return res.status(503).json({ success: false, error: "WhatsApp engine is offline. Visit your /qr endpoint first." });
    }
    if (!number || !message) {
        return res.status(400).json({ success: false, error: "Provide 'number' and 'message' parameters." });
    }

    try {
        const chatId = number.trim().replace(/[^\d]/g, '') + "@c.us";
        await client.sendMessage(chatId, message);
        return res.status(200).json({ success: true, message: `Message sent to ${number}` });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Base API status route
app.get('/', (req, res) => {
    res.json({ ready: isClientReady, mode: "Render Cloud Deployment" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    client.initialize().catch(err => console.error("Initialization error:", err));
});
