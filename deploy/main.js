const express = require('express');
const session = require('express-session');
const fs = require('fs');
const dayjs = require('dayjs');
const compression = require('compression');
const HttpsProxyAgent = require('https-proxy-agent');
const { AuthorizationCode } = require('simple-oauth2');
const setupWebSocket = require('./setupWebSocket');

let cachedOAuthMeta = null;

const migMetaFile = process.env['MIGMETA_FILE'] || '/srv/migmeta.json';
const viewsDir = process.env['VIEWS_DIR'] || '/srv/views';
const staticDir = process.env['STATIC_DIR'] || '/srv/static';

const brandType = process.env['BRAND_TYPE'];

const migMetaStr = fs.readFileSync(migMetaFile, 'utf8');
const migMeta = JSON.parse(migMetaStr);

const sanitizeMigMeta = (migMeta) => {
  const oauthCopy = { ...migMeta.oauth };
  delete oauthCopy.clientSecret;
  return { ...migMeta, oauth: oauthCopy };
};

const sanitizedMigMeta = sanitizeMigMeta(migMeta);

const encodedMigMeta = Buffer.from(JSON.stringify(sanitizedMigMeta)).toString('base64');

//Set proxy string if it exists
const proxyString = process.env['HTTPS_PROXY'] || process.env['HTTP_PROXY'];
const noProxyArr = process.env['NO_PROXY'] && process.env['NO_PROXY'].split(',');
let bypassProxy = false;
if (noProxyArr && noProxyArr.length) {
  bypassProxy = noProxyArr.some((s) => migMeta.clusterApi.includes(s));
}
let httpOptions = {};
let axios;
if (proxyString && !bypassProxy) {
  httpOptions = {
    agent: new HttpsProxyAgent(proxyString),
  };
  const axiosProxyConfig = {
    proxy: false,
    httpsAgent: new HttpsProxyAgent(proxyString),
  };
  axios = require('axios').create(axiosProxyConfig);
} else {
  axios = require('axios');
}

console.log('migMetaFile: ', migMetaFile);
console.log('viewsDir: ', viewsDir);
console.log('staticDir: ', staticDir);
console.log('migMeta: ', migMeta);

const app = express();
app.use(compression());
app.engine('ejs', require('ejs').renderFile);
app.set('views', viewsDir);
app.use(express.static(staticDir));

// NOTE: Any future backend-only routes here need to also be proxied by webpack dev server (Now `webpack serve` as of webpack version 5).
//       Add them to config/webpack.dev.js in the array under devServer.proxy.context.

app.get('/login', async (req, res, next) => {
  try {
    const clusterAuth = await getClusterAuth();
    const authorizationUri = clusterAuth.authorizeURL({
      redirect_uri: migMeta.oauth.redirectUrl,
      scope: migMeta.oauth.userScope,
    });

    res.redirect(authorizationUri);
  } catch (error) {
    console.error(error);
    if (error.response.statusText === 'Service Unavailable' || error.response.status === 503) {
      res.status(503).send(error.response.data);
    } else {
      const params = new URLSearchParams({ error: JSON.stringify(error) });
      const uri = `/handle-login?${params.toString()}`;
      res.redirect(uri);
      next(error);
    }
  }
});
app.get('/login/callback', async (req, res, next) => {
  const { code } = req.query;
  const options = {
    code,
    redirect_uri: migMeta.oauth.redirectUrl,
  };
  try {
    const clusterAuth = await getClusterAuth();
    const accessToken = await clusterAuth.getToken(options, httpOptions);
    const currentUnixTime = dayjs().unix();
    const user = {
      ...accessToken.token,
      login_time: currentUnixTime,
      expiry_time: currentUnixTime + accessToken.token.expires_in,
    };

    const params = new URLSearchParams({ user: JSON.stringify(user) });
    const uri = `/handle-login?${params.toString()}`;
    res.redirect(uri);
  } catch (error) {
    console.error('Access Token Error', error.message);
    return res.status(500).json('Authentication failed');
  }
});

app.get('*', (req, res) => {
  res.render('index.ejs', { migMeta: encodedMigMeta, brandType });
});

setupWebSocket(app, axios);

const getOAuthMeta = async () => {
  if (cachedOAuthMeta) {
    return cachedOAuthMeta;
  }
  const oAuthMetaUrl = `${migMeta.clusterApi}/.well-known/oauth-authorization-server`;
  const res = await axios.get(oAuthMetaUrl);
  cachedOAuthMeta = res.data;
  return cachedOAuthMeta;
};

const getClusterAuth = async () => {
  const oAuthMeta = await getOAuthMeta();
  return new AuthorizationCode({
    client: {
      id: migMeta.oauth.clientId,
      secret: migMeta.oauth.clientSecret,
    },
    auth: {
      tokenHost: oAuthMeta.token_endpoint,
      authorizePath: oAuthMeta.authorization_endpoint,
    },
  });
};
