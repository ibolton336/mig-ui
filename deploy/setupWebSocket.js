const { createTextSpan } = require('typescript');

function setupWebSocket(app) {
  const port = process.env['EXPRESS_PORT'] || 9000;

  const k8s = require('@kubernetes/client-node');
  const request = require('request');
  let WSServer = require('ws').Server;
  let server = require('http').createServer();
  let wss = new WSServer({
    server: server,
  });

  server.on('request', app);

  // what to do after a connection is established
  wss.on('connection', (ctx) => {
    // print number of active connections
    console.log('connected', wss.clients.size);
    ctx.send('Welcome to the app! :)');

    ctx.on('message', (data) => {
      let message;

      try {
        message = JSON.parse(data);
        console.log(`received: ${message}`);
      } catch (e) {
        sendError(ws, 'Wrong format');

        return;
      }

      if (message.type === 'GET_EVENTS') {
        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        const opts = {};
        kc.applyToRequest(opts);
        request.get(
          `${kc.getCurrentCluster().server}/api/v1/namespaces/openshift-migration/events`,
          opts,
          (error, response, body) => {
            if (error) {
              console.log(`error: ${error}`);
            }
            if (response) {
              console.log(`statusCode: ${response.statusCode}`);
              const messageObject = {
                type: 'GET_EVENTS',
                data: response.body,
              };
              ctx.send(JSON.stringify(messageObject));
            }
            console.log(`body: ${body}`);
          }
        );
      }
    });

    // handle close event
    ctx.on('close', () => {
      console.log('closed', wss.clients.size);
    });

    // sent a message that we're good to proceed
    // ctx.send('connection established.');
  });

  server.listen(port, function () {
    console.log(`http/ws server listening on ${port}`);
  });
}

// wss.on('connection', function connection(ws) {
//   const k8s = require('@kubernetes/client-node');
//   const request = require('request');

//   const kc = new k8s.KubeConfig();
//   kc.loadFromDefault();

//   const opts = {};
//   kc.applyToRequest(opts);

//   // const k8s = require('@kubernetes/client-node');

//   // const kc = new k8s.KubeConfig();
//   // kc.loadFromDefault();

//   // const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
//   // const k8sApi = kc.makeApiClient(k8s.);

//   ws.on('message', function incoming(message) {
//     console.log(`received: ${message}`);
//     // k8sApi.listNamespacedPod('openshift-migration').then((res) => {

//     const k8s = require('@kubernetes/client-node');
//     const request = require('request');

//     const kc = new k8s.KubeConfig();
//     kc.loadFromDefault();

//     const opts = {};
//     kc.applyToRequest(opts);

//     request.get(
//       `${kc.getCurrentCluster().server}/api/v1/namespaces/openshift-migration/events`,
//       opts,
//       (error, response, body) => {
//         if (error) {
//           console.log(`error: ${error}`);
//         }
//         if (response) {
//           console.log(`statusCode: ${response.statusCode}`);
//           ws.send(
//             JSON.stringify({
//               answer: response.body,
//             })
//           );
//         }
//         console.log(`body: ${body}`);
//       }
//     );

//     // ws.send(
//     //   JSON.stringify({
//     //     answer: res.body,
//     //   })
//     // );
//   });
// });
// // });

module.exports = setupWebSocket;
