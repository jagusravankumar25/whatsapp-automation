const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY;
const AUTH_PATH =
  process.env.WWEBJS_AUTH_PATH || path.join(__dirname, '.wwebjs_auth');
const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

if (!API_KEY || API_KEY.length < 24) {
  throw new Error('Set API_KEY to a random secret of at least 24 characters.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

function isValidApiKey(value) {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(API_KEY);
  return supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);
}

function requireApiKey(req, res, next) {
  if (!isValidApiKey(req.get('x-api-key'))) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: provide a valid x-api-key header.'
    });
  }
  next();
}

io.use((socket, next) => {
  if (!isValidApiKey(socket.handshake.auth?.token)) {
    return next(new Error('Unauthorized'));
  }
  next();
});

let client = null;
let isReady = false;
let isStarting = false;
let currentQR = null;
let state = 'disconnected';

function publish(event, payload) {
  io.emit(event, payload);
}

function setDisconnected(reason) {
  isReady = false;
  isStarting = false;
  currentQR = null;
  state = 'disconnected';
  publish('disconnected', reason || null);
}

function createWhatsAppClient() {
  const whatsapp = new Client({
    authStrategy: new LocalAuth({
      clientId: 'main',
      dataPath: AUTH_PATH
    }),
    puppeteer: {
      executablePath: CHROME_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    }
  });

  whatsapp.on('qr', async (qr) => {
    try {
      currentQR = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280
      });
      state = 'waiting_for_scan';
      publish('qr', currentQR);
      console.log('WhatsApp QR generated.');
    } catch (error) {
      console.error('Could not generate QR:', error);
      publish('connection-error', 'QR generation failed.');
    }
  });

  whatsapp.on('authenticated', () => {
    state = 'authenticating';
    publish('authenticating');
    console.log('WhatsApp authenticated; waiting for client readiness.');
  });

  whatsapp.on('ready', () => {
    isReady = true;
    isStarting = false;
    currentQR = null;
    state = 'connected';
    publish('connected');
    console.log('WhatsApp client is ready.');
  });

  whatsapp.on('auth_failure', (message) => {
    console.error('WhatsApp authentication failure:', message);
    isReady = false;
    isStarting = false;
    currentQR = null;
    state = 'disconnected';
    publish('connection-error', 'WhatsApp authentication failed.');
  });

  whatsapp.on('disconnected', async (reason) => {
    console.warn('WhatsApp disconnected:', reason);
    setDisconnected(String(reason || 'Disconnected'));

    // Do not automatically create repeated browser sessions.
    if (client === whatsapp) client = null;
  });

  return whatsapp;
}

async function startWhatsApp() {
  if (isReady || isStarting) return;

  isStarting = true;
  state = 'connecting';
  publish('connection-status', { status: state, qr: null });

  const whatsapp = createWhatsAppClient();
  client = whatsapp;

  try {
    await whatsapp.initialize();
  } catch (error) {
    console.error('WhatsApp initialization failed:', error);
    if (client === whatsapp) client = null;
    isReady = false;
    isStarting = false;
    currentQR = null;
    state = 'disconnected';
    publish('connection-error', 'Could not start Chromium/WhatsApp. Check Render logs.');
    try {
      await whatsapp.destroy();
    } catch (_) {
      // The browser may not have started.
    }
  }
}

// SERVICE 1: HTML connection page.
// The API key is checked in the Socket.IO handshake before QR/status events
// can be received and before a connection can be started.
app.get('/connect', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Connector</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; padding: 24px;
      display: grid; place-items: center;
      background: #f1f5f4; color: #172321;
      font-family: Arial, sans-serif;
    }
    .card {
      width: 100%; max-width: 430px; padding: 30px;
      border-radius: 18px; background: #fff;
      box-shadow: 0 12px 40px rgba(0,0,0,.08);
      text-align: center;
    }
    h1 { margin: 0 0 8px; color: #087f65; font-size: 25px; }
    p { color: #66736f; line-height: 1.5; }
    input, button {
      width: 100%; border-radius: 9px; padding: 14px;
      font-size: 15px; margin-top: 12px;
    }
    input { border: 1px solid #d5dfdc; }
    button {
      border: 0; color: white; background: #087f65;
      cursor: pointer; font-weight: 600;
    }
    button:disabled { opacity: .6; cursor: not-allowed; }
    #qr { display: none; width: 280px; max-width: 100%; margin: 22px auto 8px; }
    #status { margin: 18px 0 0; font-weight: 600; overflow-wrap: anywhere; }
    .ok { color: #087f65; }
    .bad { color: #c0392b; }
    .help {
      margin-top: 20px; padding: 13px; border-radius: 10px;
      background: #f4f8f6; color: #53615c; font-size: 13px;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>WhatsApp Connector</h1>
    <p>Connect the WhatsApp account running on this server.</p>
    <input id="apiKey" type="password" autocomplete="off"
      placeholder="Enter your API key" aria-label="API key">
    <button id="connectButton" type="button">Connect WhatsApp</button>
    <div id="status" role="status" aria-live="polite">Not connected</div>
    <img id="qr" alt="WhatsApp link-device QR code">
    <div class="help">
      On your phone, open WhatsApp → Linked Devices → Link a Device,
      then scan the QR code shown here. Keep this page private.
    </div>
  </main>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const keyInput = document.getElementById('apiKey');
    const button = document.getElementById('connectButton');
    const statusEl = document.getElementById('status');
    const qr = document.getElementById('qr');
    let socket;

    function status(message, type) {
      statusEl.textContent = message;
      statusEl.className = type || '';
    }

    function showQR(data) {
      qr.src = data;
      qr.style.display = 'block';
      button.disabled = false;
      button.textContent = 'Waiting for QR scan';
      status('Scan this QR using WhatsApp → Linked Devices');
    }

    button.addEventListener('click', () => {
      const token = keyInput.value.trim();
      if (!token) {
        status('Enter your API key first.', 'bad');
        return;
      }

      button.disabled = true;
      status('Connecting to server...');

      if (socket) socket.disconnect();
      socket = io({ auth: { token } });

      socket.on('connect', () => {
        keyInput.style.display = 'none';
        socket.emit('start-connection');
        status('Starting WhatsApp and Chromium...');
      });

      socket.on('connect_error', (error) => {
        button.disabled = false;
        status(error.message === 'Unauthorized'
          ? 'Invalid API key.' : 'Could not connect to the server.', 'bad');
      });

      socket.on('connection-status', (data) => {
        if (data.status === 'connected') {
          qr.style.display = 'none';
          button.disabled = true;
          button.textContent = 'Connected';
          status('WhatsApp connected successfully.', 'ok');
        } else if (data.status === 'waiting_for_scan' && data.qr) {
          showQR(data.qr);
        } else if (data.status === 'authenticating') {
          qr.style.display = 'none';
          status('Authenticated. Waiting for WhatsApp to become ready...');
        } else if (data.status === 'connecting') {
          status('Starting WhatsApp...');
        } else {
          status('Not connected. Press Connect WhatsApp to start.');
          button.disabled = false;
        }
      });

      socket.on('qr', showQR);

      socket.on('authenticating', () => {
        qr.style.display = 'none';
        status('QR accepted. Finishing authentication...');
      });

      socket.on('connected', () => {
        qr.style.display = 'none';
        button.disabled = true;
        button.textContent = 'Connected';
        status('WhatsApp connected successfully.', 'ok');
      });

      socket.on('connection-error', (message) => {
        button.disabled = false;
        button.textContent = 'Try Again';
        status(typeof message === 'string' ? message : 'Connection failed. Check server logs.', 'bad');
      });

      socket.on('disconnected', () => {
        qr.style.display = 'none';
        button.disabled = false;
        button.textContent = 'Reconnect WhatsApp';
        status('WhatsApp disconnected. Reconnect when ready.', 'bad');
      });
    });
  </script>
</body>
</html>`);
});

// Only authorized Socket.IO clients can start WhatsApp or receive its QR.
io.on('connection', (socket) => {
  socket.emit('connection-status', {
    status: state,
    qr: currentQR
  });

  socket.on('start-connection', () => {
    startWhatsApp().catch((error) => {
      console.error('Unexpected startup error:', error);
      socket.emit('connection-error', 'Unexpected connection error.');
    });
  });
});

// SERVICE 2: send one text message.
app.post('/send-message', requireApiKey, async (req, res) => {
  const { number, message } = req.body || {};

  if (!isReady || !client) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp is not connected. Open /connect and connect first.'
    });
  }

  if (typeof number !== 'string' || typeof message !== 'string' ||
      !number.trim() || !message.trim()) {
    return res.status(400).json({
      success: false,
      error: 'number and message must be non-empty strings.'
    });
  }

  const cleanNumber = number.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(cleanNumber)) {
    return res.status(400).json({
      success: false,
      error: 'Use an international phone number with country code, digits only.'
    });
  }

  try {
    const chatId = `${cleanNumber}@c.us`;
    await client.sendMessage(chatId, message);
    return res.json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('send-message failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Message could not be sent. Check the number and server logs.'
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Connection page: /connect');
});
