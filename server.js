require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      wallet: {
        apiKey: '',
        rpcHost: '127.0.0.1',
        rpcPort: 13037,
        network: 'mainnet'
      },
      domains: [
        {
          id: 'dom_1',
          name: 'myproject',
          type: 'Handshake TLD',
          status: 'REGISTERED',
          hnsBridge: 'https://myproject.hns.to',
          records: [
            { id: 'rec_1', type: 'A', name: '@', value: '127.0.0.1', ttl: 300 },
            { id: 'rec_2', type: 'TXT', name: '@', value: 'v=spf1 ~all', ttl: 3600 }
          ]
        },
        {
          id: 'dom_2',
          name: 'myproject.com',
          type: 'Web2 Domain',
          status: 'CONNECTED',
          hnsBridge: '',
          records: [
            { id: 'rec_3', type: 'A', name: '@', value: '127.0.0.1', ttl: 600 },
            { id: 'rec_4', type: 'CNAME', name: 'www', value: 'myproject.com', ttl: 600 }
          ]
        }
      ]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { wallet: {}, domains: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Veri kaydetme hatası:', e);
  }
}

async function callBobWallet(method, params = []) {
  const data = loadData();
  const { rpcHost, rpcPort, apiKey } = data.wallet;

  const authHeader = apiKey ? 'Basic ' + Buffer.from(`x:${apiKey}`).toString('base64') : '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`http://${rpcHost}:${rpcPort}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {})
      },
      body: JSON.stringify({ method, params }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`RPC Hatası: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

app.get('/api/info', (req, res) => {
  res.json({
    status: 'ACTIVE',
    host: req.headers.host || `localhost:${PORT}`,
    ip: req.ip || '127.0.0.1',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/wallet/status', async (req, res) => {
  const data = loadData();
  try {
    const rpcInfo = await callBobWallet('getinfo');
    res.json({
      connected: true,
      config: data.wallet,
      info: rpcInfo.result || rpcInfo
    });
  } catch (err) {
    res.json({
      connected: false,
      config: data.wallet,
      error: 'Bob Wallet çevrimdışı veya RPC kapalı.'
    });
  }
});

app.post('/api/wallet/config', (req, res) => {
  const { rpcHost, rpcPort, apiKey } = req.body;
  const data = loadData();
  data.wallet.rpcHost = rpcHost || '127.0.0.1';
  data.wallet.rpcPort = Number(rpcPort) || 13037;
  data.wallet.apiKey = apiKey || '';
  saveData(data);
  res.json({ success: true, wallet: data.wallet });
});

app.get('/api/domains/search', async (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!query) return res.status(400).json({ error: 'Sorgu boş olamaz.' });

  try {
    const rpcRes = await callBobWallet('getnameinfo', [query]);
    res.json({ name: query, available: false, details: rpcRes.result });
  } catch {
    res.json({
      name: query,
      available: true,
      hnsTld: `${query}/`,
      suggestedPrice: '5 HNS',
      web2Match: `${query}.com`
    });
  }
});

app.get('/api/domains', (req, res) => {
  const data = loadData();
  res.json(data.domains);
});

app.post('/api/domains', (req, res) => {
  const { name, type, ip } = req.body;
  if (!name) return res.status(400).json({ error: 'Domain adı gerekli' });

  const data = loadData();
  const cleanName = name.toLowerCase().trim();
  const isHns = type === 'Handshake TLD' || !cleanName.includes('.');

  const newDomain = {
    id: 'dom_' + Date.now(),
    name: cleanName,
    type: isHns ? 'Handshake TLD' : 'Web2 Domain',
    status: 'ACTIVE',
    hnsBridge: isHns ? `https://${cleanName}.hns.to` : '',
    records: [
      { id: 'rec_' + Date.now(), type: 'A', name: '@', value: ip || '127.0.0.1', ttl: 300 }
    ]
  };

  data.domains.unshift(newDomain);
  saveData(data);
  res.status(201).json(newDomain);
});

app.delete('/api/domains/:id', (req, res) => {
  const data = loadData();
  data.domains = data.domains.filter(d => d.id !== req.params.id);
  saveData(data);
  res.json({ success: true });
});

app.post('/api/domains/:id/records', (req, res) => {
  const { type, name, value, ttl } = req.body;
  const data = loadData();
  const domain = data.domains.find(d => d.id === req.params.id);

  if (!domain) return res.status(404).json({ error: 'Domain bulunamadı' });

  const record = {
    id: 'rec_' + Date.now(),
    type: type || 'A',
    name: name || '@',
    value: value || '127.0.0.1',
    ttl: Number(ttl) || 600
  };

  domain.records.push(record);
  saveData(data);
  res.status(201).json(record);
});

app.delete('/api/domains/:domainId/records/:recordId', (req, res) => {
  const data = loadData();
  const domain = data.domains.find(d => d.id === req.params.domainId);
  if (!domain) return res.status(404).json({ error: 'Domain bulunamadı' });

  domain.records = domain.records.filter(r => r.id !== req.params.recordId);
  saveData(data);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HNS Spaceship Panel] Port: ${PORT}`);
});
