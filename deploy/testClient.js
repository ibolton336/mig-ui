// import * as k8s from '@kubernetes/client-node';
const k8s = require('@kubernetes/client-node');

const testClient = () => {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

  k8sApi
    .listNamespacedPod('default')
    .then((res) => {
      console.log(res.body);
      return res.body;
    })
    .catch((err) => {
      console.log(err);
      return err;
    });
};
const informer = () => {
  console.log('informer startingg');
  debugger;
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

  const listFn = () => k8sApi.listNamespacedPod('default');

  const informer = k8s.makeInformer(kc, '/api/v1/namespaces/default/pods', listFn);

  informer.on('add', (obj) => {
    console.log(`Added: ${obj.metadata && obj.metadata.name}`);
  });
  informer.on('update', (obj) => {
    console.log(`Updated: ${obj.metadata && obj.metadata.name}`);
  });
  informer.on('delete', (obj) => {
    console.log(`Deleted: ${obj.metadata && obj.metadata.name}`);
  });
  informer.on('error', (err) => {
    console.error(err);
    // Restart informer after 5sec
    setTimeout(() => {
      informer.start();
    }, 5000);
  });

  informer.start();
};
exports.testClient = testClient;
exports.informer = informer;
