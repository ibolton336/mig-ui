import {
  takeEvery,
  takeLatest,
  select,
  retry,
  race,
  call,
  delay,
  put,
  take,
} from 'redux-saga/effects';
import { IClusterClient } from '../../../../client/client';
import { ClientFactory } from '../../../../client/client_factory';
import { MigResource, MigResourceKind } from '../../../../client/resources';
import { createMigMigration } from '../../../../client/resources/conversions';
import { IReduxState } from '../../../../reducers';
import { certErrorOccurred } from '../../../auth/duck/slice';
import {
  alertSuccessTimeout,
  alertErrorTimeout,
  alertProgressTimeout,
  alertWarn,
  alertErrorModal,
} from '../../../common/duck/slice';
import { IAlertModalObj } from '../../../common/duck/types';
import utils from '../../../common/duck/utils';
import { PlanActions, PlanActionTypes } from '../../duck';
import {
  createMigrationFailure,
  createMigrationRequest,
  createMigrationSuccess,
  migrationSuccess,
  runMigrationRequest,
  startMigrationPolling,
  stopMigrationPolling,
  updateMigrations,
} from './slice';

const uuidv1 = require('uuid/v1');
const MigrationPollingInterval = 5000;

// function* fetchMigrationsGenerator() {
//   const state = yield select();
//   const client: IClusterClient = ClientFactory.cluster(state);
//   const resource = new MigResource(MigResourceKind.MigMigration, state.auth.migMeta.namespace);
//   try {
//     let migrationList = yield client.list(resource);
//     migrationList = yield migrationList.data.items;

//     return { migrations: migrationList };
//   } catch (e) {
//     throw e;
//   }
// }

function* migrationCancel(action) {
  const state: IReduxState = yield select();
  const migMeta = state.auth.migMeta;
  const client: IClusterClient = ClientFactory.cluster(state);
  try {
    const migration = yield client.get(
      new MigResource(MigResourceKind.MigMigration, migMeta.namespace),
      action.migrationName
    );
    if (migration.data.spec.canceled) {
      return;
    }
    const canceledMigrationSpec = {
      spec: {
        canceled: true,
      },
    };
    yield client.patch(
      new MigResource(MigResourceKind.MigMigration, migMeta.namespace),
      action.migrationName,
      canceledMigrationSpec
    );
    yield put(PlanActions.migrationCancelSuccess(action.migrationName));
    yield put(alertSuccessTimeout(`Cancel requested for "${action.migrationName}"!`));
  } catch (err) {
    yield put(PlanActions.migrationCancelFailure(err, action.migrationName));
    yield put(alertErrorTimeout(`Failed to cancel "${action.migrationName}"`));
  }
}

function getStageStatusCondition(updatedPlans, createMigRes) {
  const matchingPlan = updatedPlans.updatedPlans.find(
    (p) => p.MigPlan.metadata.name === createMigRes.data.spec.migPlanRef.name
  );
  const statusObj = { status: null, planName: null, errorMessage: null };

  if (matchingPlan && matchingPlan.Migrations) {
    const matchingMigration = matchingPlan.Migrations.find(
      (s) => s.metadata.name === createMigRes.data.metadata.name
    );

    if (matchingMigration && matchingMigration.status?.conditions) {
      const hasSucceededCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Succeeded'
      );
      if (hasSucceededCondition) {
        statusObj.status = 'SUCCESS';
      }

      const hasErrorCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Failed' || c.category === 'Critical'
      );
      const errorCondition = matchingMigration.status.conditions.find(
        (c) => c.type === 'Failed' || c.category === 'Critical'
      );
      if (hasErrorCondition) {
        statusObj.status = 'FAILURE';
        statusObj.errorMessage = errorCondition.message;
      }

      const hasWarnCondition = !!matchingMigration.status.conditions.some(
        (c) => c.category === 'Warn'
      );
      const warnCondition = matchingMigration.status.conditions.find((c) => c.category === 'Warn');

      if (hasWarnCondition) {
        statusObj.status = 'WARN';
        statusObj.errorMessage = warnCondition.message;
      }
      statusObj.planName = matchingPlan.MigPlan.metadata.name;
    }
  }
  return statusObj;
}
function* runStageSaga(action) {
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);
    const { plan } = action;
    const migrationName = `stage-${uuidv1().slice(0, 5)}`;

    yield put(PlanActions.initStage(plan.MigPlan.metadata.name));
    yield put(alertProgressTimeout('Staging Started'));

    const migMigrationObj = createMigMigration(
      migrationName,
      plan.MigPlan.metadata.name,
      migMeta.namespace,
      true,
      true,
      false
    );
    const migMigrationResource = new MigResource(MigResourceKind.MigMigration, migMeta.namespace);

    //created migration response object
    const createMigRes = yield client.create(migMigrationResource, migMigrationObj);
    const migrationListResponse = yield client.list(migMigrationResource);
    // const groupedPlan = planUtils.groupPlan(plan, migrationListResponse);

    const params = {
      // fetchPlansGenerator: fetchMigrationsGenerator,
      delay: MigrationPollingInterval,
      getStageStatusCondition: getStageStatusCondition,
      createMigRes: createMigRes,
    };

    yield put(PlanActions.startStagePolling(params));
    // yield put(PlanActions.updatePlanMigrations(groupedPlan));
  } catch (err) {
    yield put(alertErrorTimeout(err));
    yield put(PlanActions.stagingFailure(err));
  }
}

function* stagePoll(action) {
  const params = { ...action.params };
  while (true) {
    const updatedPlans = yield call(params.fetchPlansGenerator);
    const pollingStatusObj = params.getStageStatusCondition(updatedPlans, params.createMigRes);

    switch (pollingStatusObj.status) {
      case 'SUCCESS':
        yield put(PlanActions.stagingSuccess(pollingStatusObj.planName));
        yield put(alertSuccessTimeout('Staging Successful'));
        yield put(PlanActions.stopStagePolling());
        break;
      case 'FAILURE':
        yield put(PlanActions.stagingFailure(pollingStatusObj.error));
        yield put(alertErrorTimeout(`${pollingStatusObj.errorMessage || 'Staging Failed'}`));
        yield put(PlanActions.stopStagePolling());
        break;
      case 'WARN':
        yield put(PlanActions.stagingFailure(pollingStatusObj.error));
        yield put(alertWarn(`Warning(s) occurred during stage: ${pollingStatusObj.errorMessage}`));
        yield put(PlanActions.stopStagePolling());
        break;
      default:
        break;
    }
    yield delay(params.delay);
  }
}

function getMigrationStatusCondition(updatedPlans, createMigRes) {
  const matchingPlan = updatedPlans.updatedPlans.find(
    (p) => p.MigPlan.metadata.name === createMigRes.data.spec.migPlanRef.name
  );
  const statusObj = { status: null, planName: null, errorMessage: null };

  if (matchingPlan && matchingPlan.Migrations) {
    const matchingMigration = matchingPlan.Migrations.find(
      (s) => s.metadata.name === createMigRes.data.metadata.name
    );

    if (matchingMigration && matchingMigration.status?.conditions) {
      const hasSucceededCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Succeeded'
      );
      const hasCanceledCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Canceled'
      );
      if (hasCanceledCondition) {
        statusObj.status = 'CANCELED';
      } else if (hasSucceededCondition) {
        const hasWarnCondition = !!matchingMigration.status.conditions.some(
          (c) => c.category === 'Warn'
        );
        const warnCondition = matchingMigration.status.conditions.find(
          (c) => c.category === 'Warn'
        );

        if (hasWarnCondition) {
          statusObj.status = 'WARN';
          statusObj.errorMessage = warnCondition.message;
        } else {
          statusObj.status = 'SUCCESS';
        }
      }
      const hasErrorCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Failed' || c.category === 'Critical'
      );
      const errorCondition = matchingMigration.status.conditions.find(
        (c) => c.type === 'Failed' || c.category === 'Critical'
      );
      if (hasErrorCondition) {
        statusObj.status = 'FAILURE';
        statusObj.errorMessage = errorCondition.message;
      }
      statusObj.planName = matchingPlan.MigPlan.metadata.name;
    }
  }
  return statusObj;
}

function* runMigrationSaga(action) {
  try {
    const { plan, enableQuiesce } = action;
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);
    const migrationName = `migration-${uuidv1().slice(0, 5)}`;
    yield put(createMigrationRequest(plan.MigPlan.metadata.name));
    yield put(alertProgressTimeout('Migration Started'));

    const migMigrationObj = createMigMigration(
      migrationName,
      plan.MigPlan.metadata.name,
      migMeta.namespace,
      false,
      enableQuiesce,
      false
    );
    const migMigrationResource = new MigResource(MigResourceKind.MigMigration, migMeta.namespace);

    //created migration response object
    const createMigRes = yield client.create(migMigrationResource, migMigrationObj);

    const migrationListResponse = yield client.list(migMigrationResource);
    // const groupedPlan = planUtils.groupPlan(plan, migrationListResponse);

    // const params = {
    //   fetchPlansGenerator: fetchMigrationsGenerator,
    //   delay: MigrationPollingInterval,
    //   getMigrationStatusCondition: getMigrationStatusCondition,
    //   createMigRes: createMigRes,
    // };

    // yield put(startMigrationPolling(params));
    yield put(createMigrationSuccess(createMigRes));
  } catch (err) {
    yield put(alertErrorTimeout(err));
    yield put(createMigrationFailure(err));
  }
}
function* migrationPoll(action) {
  const params = { ...action.payload };
  while (true) {
    const state = yield select();
    const client: IClusterClient = ClientFactory.cluster(state);
    const resource = new MigResource(MigResourceKind.MigMigration, state.auth.migMeta.namespace);
    try {
      let migrationList = yield client.list(resource);
      migrationList = yield migrationList.data.items;

      // const updatedMigrations = yield call(fetchMigrationsGenerator);
      yield put(updateMigrations(migrationList));
    } catch (e) {
      const state: IReduxState = yield select();
      const migMeta = state.auth.migMeta;
      //handle selfSignedCert error & network connectivity error
      if (utils.isSelfSignedCertError(e)) {
        const oauthMetaUrl = `${migMeta.clusterApi}/.well-known/oauth-authorization-server`;
        const alertModalObj: IAlertModalObj = {
          name: params.pollName,
          errorMessage: 'error',
        };
        if (state.common.errorModalObject === null) {
          yield put(alertErrorModal(alertModalObj));
          yield put(certErrorOccurred(oauthMetaUrl));
        }
      }
    }

    // const pollingStatusObj = getMigrationStatusCondition(updatedMigrations, params.createMigRes);

    // switch (pollingStatusObj.status) {
    //   case 'CANCELED':
    //     yield put(alertSuccessTimeout('Migration canceled'));
    //     yield put(PlanActions.stopMigrationPolling());
    //     break;
    //   case 'SUCCESS':
    //     yield put(PlanActions.migrationSuccess(pollingStatusObj.planName));
    //     yield put(alertSuccessTimeout('Migration Successful'));
    //     yield put(PlanActions.stopMigrationPolling());
    //     break;
    //   case 'FAILURE':
    //     yield put(PlanActions.migrationFailure(pollingStatusObj.error));
    //     yield put(alertErrorTimeout(`${pollingStatusObj.errorMessage || 'Migration Failed'}`));
    //     yield put(PlanActions.stopMigrationPolling());
    //     break;
    //   case 'WARN':
    //     yield put(PlanActions.migrationFailure(pollingStatusObj.error));
    //     yield put(alertWarn(`Migration succeeded with warnings. ${pollingStatusObj.errorMessage}`));
    //     yield put(PlanActions.stopMigrationPolling());
    //     break;

    //   default:
    //     break;
    // }
    // yield delay(params.delay);
    yield delay(10000);
  }
}

function getRollbackStatusCondition(updatedPlans, createMigRes) {
  const matchingPlan = updatedPlans.updatedPlans.find(
    (p) => p.MigPlan.metadata.name === createMigRes.data.spec.migPlanRef.name
  );
  const statusObj = { status: null, planName: null, errorMessage: null };

  if (matchingPlan && matchingPlan.Migrations) {
    const matchingMigration = matchingPlan.Migrations.find(
      (s) => s.metadata.name === createMigRes.data.metadata.name
    );

    if (matchingMigration && matchingMigration.status?.conditions) {
      const hasSucceededCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Succeeded'
      );
      if (hasSucceededCondition) {
        statusObj.status = 'SUCCESS';
      }

      const hasErrorCondition = !!matchingMigration.status.conditions.some(
        (c) => c.type === 'Failed' || c.category === 'Critical'
      );
      const errorCondition = matchingMigration.status.conditions.find(
        (c) => c.type === 'Failed' || c.category === 'Critical'
      );
      if (hasErrorCondition) {
        statusObj.status = 'FAILURE';
        statusObj.errorMessage = errorCondition.message;
      }

      const hasWarnCondition = !!matchingMigration.status.conditions.some(
        (c) => c.category === 'Warn'
      );
      const warnCondition = matchingMigration.status.conditions.find((c) => c.category === 'Warn');

      if (hasWarnCondition) {
        statusObj.status = 'WARN';
        statusObj.errorMessage = warnCondition.message;
      }
      statusObj.planName = matchingPlan.MigPlan.metadata.name;
    }
  }
  return statusObj;
}

function* runRollbackSaga(action) {
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);
    const { plan } = action;
    const migrationName = `rollback-${uuidv1().slice(0, 5)}`;

    yield put(PlanActions.initStage(plan.MigPlan.metadata.name));
    yield put(alertProgressTimeout('Rollback Started'));

    const migMigrationObj = createMigMigration(
      migrationName,
      plan.MigPlan.metadata.name,
      migMeta.namespace,
      false,
      false,
      true
    );
    const migMigrationResource = new MigResource(MigResourceKind.MigMigration, migMeta.namespace);

    //created migration response object
    const createMigRes = yield client.create(migMigrationResource, migMigrationObj);
    const migrationListResponse = yield client.list(migMigrationResource);
    // const groupedPlan = planUtils.groupPlan(plan, migrationListResponse);

    const params = {
      // fetchPlansGenerator: fetchMigrationsGenerator,
      delay: MigrationPollingInterval,
      getRollbackStatusCondition: getRollbackStatusCondition,
      createMigRes: createMigRes,
    };

    yield put(PlanActions.startRollbackPolling(params));
    // yield put(PlanActions.updatePlanMigrations(groupedPlan));
  } catch (err) {
    yield put(alertErrorTimeout(err));
    yield put(PlanActions.stagingFailure(err));
  }
}

function* rollbackPoll(action) {
  const params = { ...action.params };
  while (true) {
    const updatedPlans = yield call(params.fetchPlansGenerator);
    const pollingStatusObj = params.getRollbackStatusCondition(updatedPlans, params.createMigRes);

    switch (pollingStatusObj.status) {
      case 'CANCELED':
        yield put(alertSuccessTimeout('Rollback canceled'));
        yield put(PlanActions.stopRollbackPolling());
        break;
      case 'SUCCESS':
        yield put(PlanActions.migrationSuccess(pollingStatusObj.planName));
        yield put(alertSuccessTimeout('Rollback Successful'));
        yield put(PlanActions.stopRollbackPolling());
        break;
      case 'FAILURE':
        yield put(PlanActions.migrationFailure(pollingStatusObj.error));
        yield put(alertErrorTimeout(`${pollingStatusObj.errorMessage || 'Rollback Failed'}`));
        yield put(PlanActions.stopRollbackPolling());
        break;
      case 'WARN':
        yield put(PlanActions.migrationFailure(pollingStatusObj.error));
        yield put(alertWarn(`Rollback succeeded with warnings. ${pollingStatusObj.errorMessage}`));
        yield put(PlanActions.stopRollbackPolling());
        break;

      default:
        break;
    }
    yield delay(params.delay);
  }
}

/******************************************************************** */
/* Saga watchers */
/******************************************************************** */

function* watchStagePolling() {
  while (true) {
    const data = yield take(PlanActionTypes.STAGE_POLL_START);
    yield race([call(stagePoll, data), take(PlanActionTypes.STAGE_POLL_STOP)]);
  }
}

function* watchMigrationPolling() {
  while (true) {
    const data = yield take(startMigrationPolling);
    yield race([call(migrationPoll, data), take(stopMigrationPolling)]);
  }
}

function* watchRollbackPolling() {
  while (true) {
    const data = yield take(PlanActionTypes.ROLLBACK_POLL_START);
    yield race([call(rollbackPoll, data), take(PlanActionTypes.ROLLBACK_POLL_STOP)]);
  }
}

function* watchMigrationCancel() {
  yield takeEvery(PlanActionTypes.MIGRATION_CANCEL_REQUEST, migrationCancel);
}

function* watchRunMigrationRequest() {
  yield takeLatest(runMigrationRequest, runMigrationSaga);
}

function* watchRunStageRequest() {
  yield takeLatest(PlanActionTypes.RUN_STAGE_REQUEST, runStageSaga);
}

function* watchRunRollbackRequest() {
  yield takeLatest(PlanActionTypes.RUN_ROLLBACK_REQUEST, runRollbackSaga);
}

export default {
  watchStagePolling,
  watchMigrationPolling,
  watchRollbackPolling,
  watchRunStageRequest,
  watchRunMigrationRequest,
  watchRunRollbackRequest,
  watchMigrationCancel,
  // fetchMigrationsGenerator,
};
