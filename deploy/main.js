const express = require('express');
const fs = require('fs');
const dayjs = require('dayjs');
const compression = require('compression');
const HttpsProxyAgent = require('https-proxy-agent');
const { AuthorizationCode } = require('simple-oauth2');

let cachedOAuthMeta = null;

const migMetaFile = process.env['MIGMETA_FILE'] || '/srv/migmeta.json';
const viewsDir = process.env['VIEWS_DIR'] || '/srv/views';
const staticDir = process.env['STATIC_DIR'] || '/srv/static';
const port = process.env['EXPRESS_PORT'] || 9000;

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

let WSServer = require('ws').Server;
let server = require('http').createServer();
let wss = new WSServer({
  server: server,
});

server.on('request', app);

wss.on('connection', function connection(ws) {
  const k8s = require('@kubernetes/client-node');

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

  ws.on('message', function incoming(message) {
    console.log(`received: ${message}`);
    k8sApi.listNamespacedPod('openshift-migration').then((res) => {
      ws.send(
        JSON.stringify({
          answer: res.body,
        })
      );
    });
  });
});

server.listen(port, function () {
  console.log(`http/ws server listening on ${port}`);
});
// const server = http.createServer(app);
// const server = require('http').createServer(app);
// var io = require('socket.io')(server);

// io.on('connection', function (socket) {
//   console.log('connected socket!');

//   socket.on('greet', function (data) {
//     console.log(data);
//     socket.emit('respond', { hello: 'Hey, Mr.Client!' });
//   });
//   socket.on('disconnect', function () {
//     console.log('Socket disconnected');
//   });
// });
// server.listen(3000, () => {
//   console.log('listening on *:3000');
// });
// app.listen(port, () => {
// console.log(`App listening on port ${port}`);
// });

//Web socket initialization

// const WebSocket = require('ws');
// const httpServer = require('http').createServer(app);

// const wss = new WebSocket.Server({
//   port: 8000,
// perMessageDeflate: {
//   zlibDeflateOptions: {
//     // See zlib defaults.
//     chunkSize: 1024,
//     memLevel: 7,
//     level: 3,
//   },
//   zlibInflateOptions: {
//     chunkSize: 10 * 1024,
//   },
//   // Other options settable:
//   clientNoContextTakeover: true, // Defaults to negotiated value.
//   serverNoContextTakeover: true, // Defaults to negotiated value.
//   serverMaxWindowBits: 10, // Defaults to negotiated value.
//   // Below options specified as default values.
//   concurrencyLimit: 10, // Limits zlib concurrency for perf.
//   threshold: 1024, // Size (in bytes) below which messages
//   // should not be compressed.
// },
//   server: httpServer,
// });
// const options = {
//   /* ... */
// };
// const io = require('socket.io')(httpServer, options);
// //

// wss.on('connection', (socket) => {
//   console.log(`App listening on port ${port} - socket:`, socket);
//   /* ... */
// });

// I'm maintaining all active connections in this object
const clients = {};

// This code generates unique userid for everyuser.
// const getUniqueID = ()
//   const s4 = () =>
//     Math.floor((1 + Math.random()) * 0x10000)
//       .toString(16)
//       .substring(1);
//   return s4() + s4() + '-' + s4();
// };

// io.on('request', function (request) {
//   var userID = getUniqueID();
//   console.log(new Date() + ' Recieved a new connection from origin ' + request.origin + '.');
//   // You can rewrite this part of the code to accept only the requests from allowed origin
//   const connection = request.accept(null, request.origin);
//   clients[userID] = connection;
//   console.log('connected: ' + userID + ' in ' + Object.getOwnPropertyNames(clients));
// });

// WARNING !!! app.listen(3000); will not work here, as it creates a new HTTP server

//Helpers

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
