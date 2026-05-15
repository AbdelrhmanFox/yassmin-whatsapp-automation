const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL: NodeURL } = require('url');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..', '..');
const TOKEN_PATH = path.join(ROOT, process.env.GOOGLE_TOKEN_PATH || 'google-tokens.json');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

function parseServiceAccountJson() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid_GOOGLE_SERVICE_ACCOUNT_JSON');
  }
}

function saveTokens(credentials) {
  if (process.env.VERCEL) return;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2), 'utf8');
}

function loadTokens() {
  if (process.env.VERCEL) return null;
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function authorizeInteractive() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('missing_GOOGLE_CLIENT_ID_or_SECRET_for_local_oauth');
  }
  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES
    });

    const server = http.createServer(async (req, res) => {
      const parsed = new NodeURL(req.url, 'http://localhost:3000');
      if (parsed.pathname !== '/oauth2callback') return;
      const code = parsed.searchParams.get('code');
      res.end('<h2>تم التفويض. أغلقي النافذة وارجعي للوحة التحكم.</h2>');
      server.close();
      try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);
        resolve(oauth2Client);
      } catch (err) {
        reject(err);
      }
    });

    server.listen(3000, () => {
      console.log('\n🔗 افتحي للتفويض على Google Sheets:\n', authUrl, '\n');
      try {
        require('open')(authUrl);
      } catch (_) {}
    });
  });
}

async function authFromServiceAccount() {
  const creds = parseServiceAccountJson();
  if (!creds) return null;
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  return auth.getClient();
}

async function authFromRefreshTokenEnv() {
  const refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refresh || !CLIENT_ID || !CLIENT_SECRET) return null;
  oauth2Client.setCredentials({ refresh_token: refresh });
  await oauth2Client.getAccessToken();
  return oauth2Client;
}

async function authFromTokenFile() {
  const stored = loadTokens();
  if (!stored?.refresh_token) return null;
  oauth2Client.setCredentials(stored);
  await oauth2Client.getAccessToken();
  saveTokens(oauth2Client.credentials);
  return oauth2Client;
}

async function getAuthClient() {
  const sa = await authFromServiceAccount();
  if (sa) return sa;

  const envRefresh = await authFromRefreshTokenEnv();
  if (envRefresh) return envRefresh;

  const fileRefresh = await authFromTokenFile();
  if (fileRefresh) return fileRefresh;

  if (process.env.VERCEL) {
    throw new Error(
      'Google auth not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on Vercel (recommended).'
    );
  }
  return authorizeInteractive();
}

async function getSheetsApi() {
  const auth = await getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

function sheetsConfigured() {
  try {
    if (parseServiceAccountJson()) return true;
  } catch (_) {}
  if (process.env.GOOGLE_REFRESH_TOKEN && CLIENT_ID && CLIENT_SECRET) return true;
  if (loadTokens()?.refresh_token) return true;
  return false;
}

module.exports = {
  getSheetsApi,
  getAuthClient,
  sheetsConfigured,
  TOKEN_PATH,
  ROOT
};
