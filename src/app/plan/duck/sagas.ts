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
import { ClientFactory } from '../../../client/client_factory';
import { IDiscoveryClient } from '../../../client/discoveryClient';
import { IClusterClient } from '../../../client/client';
import { PersistentVolumeDiscovery } from '../../../client/resources/discovery';
import {
  updateMigPlanFromValues,
  createInitialMigPlan,
  createInitialMigAnalytic,
  createMigMigration,
  createMigHook,
  updateMigHook,
  updatePlanHookList,
} from '../../../client/resources/conversions';
import { PlanActions, PlanActionTypes } from './actions';
import { CurrentPlanState } from './reducers';
import { MigResource, MigResourceKind } from '../../../client/resources';
import utils from '../../common/duck/utils';
import { NamespaceDiscovery } from '../../../client/resources/discovery';
import { DiscoveryResource } from '../../../client/resources/common';
import { push } from 'connected-react-router';
import planUtils from './utils';
import { createAddEditStatus, AddEditState, AddEditMode } from '../../common/add_edit_state';
import { IReduxState } from '../../../reducers';
import Q from 'q';
import {
  alertErrorTimeout,
  alertErrorModal,
  alertSuccessTimeout,
  alertProgressTimeout,
  alertWarn,
} from '../../common/duck/slice';
import { certErrorOccurred } from '../../auth/duck/slice';

const uuidv1 = require('uuid/v1');
const PlanMigrationPollingInterval = 5000;

const PlanUpdateTotalTries = 6;
const PlanUpdateRetryPeriodSeconds = 5;

/******************************************************************** */
/* Plan sagas */
/******************************************************************** */
function* fetchPlansGenerator() {
  // function fetchMigHookRefs(client: IClusterClient, migMeta, migPlans): Array<Promise<any>> {
  //   const refs: Array<Promise<any>> = [];

  //   migPlans.forEach((plan) => {
  //     const migHookResource = new MigResource(MigResourceKind.MigHook, migMeta.namespace);
  //     refs.push(client.list(migHookResource));
  //   });

  //   return refs;
  // }

  // function fetchMigAnalyticRefs(client: IClusterClient, migMeta, migPlans): Array<Promise<any>> {
  //   const refs: Array<Promise<any>> = [];

  //   migPlans.forEach((plan) => {
  //     const migAnalyticResource = new MigResource(MigResourceKind.MigAnalytic, migMeta.namespace);
  //     refs.push(client.list(migAnalyticResource));
  //   });

  //   return refs;
  // }

  // function fetchMigMigrationsRefs(client: IClusterClient, migMeta, migPlans): Array<Promise<any>> {
  //   const refs: Array<Promise<any>> = [];

  //   migPlans.forEach((plan) => {
  //     const migMigrationResource = new MigResource(MigResourceKind.MigMigration, migMeta.namespace);
  //     refs.push(client.list(migMigrationResource));
  //   });

  //   return refs;
  // }

  const state = yield select();
  const client: IClusterClient = ClientFactory.cluster(state);
  const resource = new MigResource(MigResourceKind.MigPlan, state.auth.migMeta.namespace);
  try {
    let planList = yield client.list(resource);
    planList = yield planList.data.items;
    const updatedPlans = planList.map((mp) => {
      const fullPlan = {
        MigPlan: mp,
        Analytics: [],
        Migrations: [],
        Hooks: [],
      };
      return fullPlan;
    });

    return { updatedPlans: updatedPlans };
  } catch (e) {
    throw e;
  }
}

function* getPlanSaga(planName) {
  const state = yield select();
  const migMeta = state.auth.migMeta;
  const client: IClusterClient = ClientFactory.cluster(state);
  return yield client.get(new MigResource(MigResourceKind.MigPlan, migMeta.namespace), planName);
}

function* deleteAnalyticSaga(action) {
  try {
    const { analytic } = action;
    const state = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);

    yield client.delete(new MigResource(MigResourceKind.MigAnalytic, migMeta.namespace), analytic);

    yield put(PlanActions.deleteAnalyticSuccess());
  } catch (err) {
    yield put(PlanActions.deleteAnalyticFailure(err));
  }
}

function* addAnalyticSaga(action) {
  const { planName } = action;
  try {
    const state = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);

    const migAnalyticObj = createInitialMigAnalytic(planName, migMeta.namespace);

    yield client.create(
      new MigResource(MigResourceKind.MigAnalytic, migMeta.namespace),
      migAnalyticObj
    );

    yield put(PlanActions.addAnalyticSuccess());
  } catch (err) {
    console.error('Failed to add migAnalytic.');
  }
}
function* addPlanSaga(action) {
  const { migPlan } = action;
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);

    const migPlanObj = createInitialMigPlan(
      migPlan.planName,
      migMeta.namespace,
      migPlan.sourceCluster,
      migPlan.sourceTokenRef,
      migPlan.targetCluster,
      migPlan.targetTokenRef,
      migPlan.selectedStorage,
      migPlan.namespaces
    );

    const createPlanRes = yield client.create(
      new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
      migPlanObj
    );

    yield put(PlanActions.setCurrentPlan(createPlanRes.data));
    yield put(PlanActions.addPlanSuccess(createPlanRes.data));
  } catch (err) {
    yield put(alertErrorTimeout('Failed to add plan'));
  }
}

function* namespaceFetchRequest(action) {
  const state: IReduxState = yield select();
  const discoveryClient: IDiscoveryClient = ClientFactory.discovery(state);
  const namespaces: DiscoveryResource = new NamespaceDiscovery(action.clusterName);
  try {
    const res = yield discoveryClient.get(namespaces);
    const namespaceResourceList = res?.data?.resources;
    if (namespaceResourceList) {
      yield put(PlanActions.namespaceFetchSuccess(namespaceResourceList));
    } else {
      const error = { type: 'new error', error: 'Unknown error.' };
      throw error;
    }
  } catch (err) {
    if (utils.isTimeoutError(err)) {
      yield put(alertErrorTimeout('Timed out while fetching namespaces'));
    } else if (utils.isSelfSignedCertError(err)) {
      const failedUrl = `${discoveryClient.apiRoot()}/${namespaces.path()}`;
      const alertModalObj = {
        name: 'SSL cert error',
        errorMessage: '',
      };
      yield put(alertErrorModal(alertModalObj));
      yield put(certErrorOccurred(failedUrl));
      return;
    }
    yield put(PlanActions.namespaceFetchFailure(err));
    yield put(alertErrorTimeout('Failed to fetch namespaces'));
  }
}

function* refreshAnalyticSaga(action) {
  const { analyticName } = action;
  const state = yield select();
  const client: IClusterClient = ClientFactory.cluster(state);
  const migMeta = state.auth.migMeta;
  try {
    yield put(PlanActions.deleteAnalyticRequest(analyticName));
    const updatedPlans = yield call(fetchPlansGenerator);
    yield put(PlanActions.updatePlans(updatedPlans.updatedPlans));
    yield put(PlanActions.addAnalyticRequest(analyticName));
    yield take(PlanActionTypes.ADD_ANALYTIC_SUCCESS);
  } catch (err) {
    yield put(PlanActions.deleteAnalyticFailure(err));
  }

  let tries = 0;
  const TicksUntilTimeout = 240;

  while (true) {
    if (tries < TicksUntilTimeout) {
      tries += 1;
      try {
        const updatedAnalytic = yield client.get(
          new MigResource(MigResourceKind.MigAnalytic, migMeta.namespace),
          analyticName
        );
        if (updatedAnalytic?.data?.status?.analytics.percentComplete === 100) {
          const updatedPlans = yield call(fetchPlansGenerator);
          yield put(PlanActions.updatePlans(updatedPlans.updatedPlans));
          yield put(PlanActions.refreshAnalyticSuccess());
        }
      } catch (err) {
        yield put(PlanActions.refreshAnalyticFailure(err));
      }
      yield delay(1000);
    } else {
      //timeout case
      yield put(alertErrorTimeout('Timed out during analytics fetch.'));
      yield put(PlanActions.refreshAnalyticFailure('Timed out'));
    }
  }
}

function* planPatchClose(planValues) {
  const state: IReduxState = yield select();
  const migMeta = state.auth.migMeta;
  const client: IClusterClient = ClientFactory.cluster(state);
  try {
    const getPlanRes = yield call(getPlanSaga, planValues.planName);
    if (getPlanRes.data.spec.closed) {
      return;
    }
    const closedPlanSpecObj = {
      spec: {
        closed: true,
      },
    };
    const patchPlanResponse = yield client.patch(
      new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
      getPlanRes.data.metadata.name,
      closedPlanSpecObj
    );
    yield put(PlanActions.updatePlanList(patchPlanResponse.data));
  } catch (err) {
    throw err;
  }
}

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

function* validatePlanSaga(action) {
  try {
    const { planValues } = action;
    yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.Pending }));

    //update plan
    yield retry(
      PlanUpdateTotalTries,
      PlanUpdateRetryPeriodSeconds * 1000,
      function* (planValues) {
        const state: IReduxState = yield select();
        const migMeta = state.auth.migMeta;
        const client: IClusterClient = ClientFactory.cluster(state);
        try {
          yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.Pending }));
          const getPlanRes = yield call(getPlanSaga, planValues.planName);
          const { currentPlan } = state.plan;
          const updatedMigPlan = updateMigPlanFromValues(getPlanRes.data, planValues, currentPlan);
          yield client.patch(
            new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
            getPlanRes.data.metadata.name,
            updatedMigPlan
          );
          yield put(PlanActions.validatePlanSuccess());
        } catch (err) {
          yield put(PlanActions.validatePlanFailure(err));
          throw err;
        }
      },
      action.planValues
    );

    const params = {
      planValues: planValues,
      delay: PlanMigrationPollingInterval,
    };
    yield put(PlanActions.validatePlanPollStart(params));
  } catch (error) {
    yield put(PlanActions.validatePlanFailure(error));
  }
}

function* validatePlanPoll(action) {
  const params = { ...action.params };
  while (true) {
    const state: IReduxState = yield select();
    const { currentPlan } = state.plan;
    let updatedPlan = null;
    const getPlanRes = yield call(getPlanSaga, currentPlan.metadata.name);
    updatedPlan = getPlanRes.data;
    const { pvStorageClassAssignment } = params.planValues;

    let isStorageClassUpdated = false;
    if (currentPlan && currentPlan.spec.persistentVolumes) {
      currentPlan.spec.persistentVolumes.forEach((currentPv) => {
        for (const formValuesPvName in pvStorageClassAssignment) {
          if (formValuesPvName === currentPv.name) {
            if (
              currentPv.selection.storageClass ||
              pvStorageClassAssignment[formValuesPvName].name
            ) {
              isStorageClassUpdated =
                pvStorageClassAssignment[formValuesPvName].name !==
                currentPv.selection.storageClass;
            }
          }
        }
      });
    }

    if (isStorageClassUpdated) {
      const updatedObservedDigest = updatedPlan.status.observedDigest;
      const oldObservedDigest = currentPlan.status.observedDigest;
      if (updatedObservedDigest !== oldObservedDigest) {
        yield put(PlanActions.setCurrentPlan(updatedPlan));
        yield put(PlanActions.updatePlanList(updatedPlan));
        yield put(PlanActions.startPlanStatusPolling(updatedPlan.metadata.name));
        yield put(PlanActions.validatePlanPollStop());
      }
    } else {
      yield put(PlanActions.setCurrentPlan(updatedPlan));
      yield put(PlanActions.updatePlanList(updatedPlan));
      yield put(PlanActions.startPlanStatusPolling(updatedPlan.metadata.name));
      yield put(PlanActions.validatePlanPollStop());
    }
    yield delay(params.delay);
  }
}

function* pvDiscoveryRequest(action) {
  try {
    yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.Pending }));
    yield retry(
      PlanUpdateTotalTries,
      PlanUpdateRetryPeriodSeconds * 1000,
      function* (planValues) {
        const state: IReduxState = yield select();
        const migMeta = state.auth.migMeta;
        const client: IClusterClient = ClientFactory.cluster(state);
        try {
          yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.Pending }));
          const getPlanRes: any = yield call(getPlanSaga, planValues.planName);
          const { currentPlan } = state.plan;
          const updatedMigPlan = updateMigPlanFromValues(getPlanRes.data, planValues, currentPlan);
          yield client.patch(
            new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
            getPlanRes.data.metadata.name,
            updatedMigPlan
          );
          const pvUpdatePollingInterval = 5000;
          const params = {
            delay: pvUpdatePollingInterval,
            initialGetPlanRes: getPlanRes,
            planValues,
          };

          yield put(PlanActions.pvDiscoverySuccess());
          yield put(PlanActions.pvUpdatePollStart(params));
        } catch (err) {
          yield put(PlanActions.pvDiscoveryFailure(err));
          throw err;
        }
      },
      action.planValues
    );
  } catch (error) {
    yield put(PlanActions.pvDiscoveryFailure(error));
  }
}

function* pvUpdatePoll(action) {
  let tries = 0;
  const TicksUntilTimeout = 240;
  const { initialGetPlanRes, planValues } = action.params;

  while (true) {
    if (tries < TicksUntilTimeout) {
      tries += 1;
      const state: IReduxState = yield select();
      const { currentPlan } = state.plan;
      if (currentPlan) {
        const getPlanResponse = yield call(getPlanSaga, currentPlan.metadata.name);
        const updatedPlan = getPlanResponse.data;

        if (currentPlan.status) {
          // Wait for refresh to complete before showing results
          const hasRefreshOnSpec = updatedPlan.spec.refresh === true;
          const doneRefreshing = !hasRefreshOnSpec;

          if (doneRefreshing) {
            // if plan done refreshing, hydrate redux store with updated controller data
            yield put(PlanActions.setCurrentPlan(updatedPlan));
            yield put(PlanActions.updatePlanList(updatedPlan));
            yield put(PlanActions.startPlanStatusPolling(updatedPlan.metadata.name));
            yield put(PlanActions.refreshAnalyticRequest(updatedPlan.metadata.name));
            yield put(PlanActions.pvUpdatePollStop());
          }
        } else {
          //initial pv set. Poll until initial status is set.
          if (updatedPlan.status) {
            yield put(PlanActions.setCurrentPlan(updatedPlan));
            yield put(PlanActions.updatePlanList(updatedPlan));
            yield put(PlanActions.startPlanStatusPolling(updatedPlan.metadata.name));
            yield put(PlanActions.pvUpdatePollStop());
          }
        }
      }
    } else {
      //timeout case
      yield put(PlanActions.pvUpdatePollStop());
      yield put(alertErrorTimeout('Timed out during PV discovery'));
      yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.TimedOut }));
      yield put(PlanActions.pvUpdatePollStop());
    }

    const PollingInterval = 1000;
    yield delay(PollingInterval);
  }
}

function* checkClosedStatus(action) {
  const PollingInterval = 5000;
  const TicksUntilTimeout = 16;
  for (let tries = 0; tries < TicksUntilTimeout; tries++) {
    const getPlanResponse = yield call(getPlanSaga, action.planName);
    const MigPlan = getPlanResponse.data;

    if (MigPlan.status?.conditions) {
      const hasClosedCondition = !!MigPlan.status.conditions.some((c) => c.type === 'Closed');
      if (hasClosedCondition) {
        yield put(PlanActions.planCloseSuccess(action.planName));
        return;
      }
    }

    yield delay(PollingInterval);
  }

  yield put(PlanActions.planCloseFailure('Failed to close plan', action.planName));
  yield put(alertErrorTimeout(`Timed out during plan close ${action.planName}`));
}

const isUpdatedPlan = (currMigPlan, prevMigPlan) => {
  const corePlan = (plan) => {
    const { metadata } = plan;
    if (metadata.annotations || metadata.resourceVersion) {
      delete metadata.annotations;
      delete metadata.resourceVersion;
    }
  };

  const currMigPlanCore = corePlan(currMigPlan);
  const prevMigPlanCore = corePlan(prevMigPlan);
  if (JSON.stringify(currMigPlanCore) !== JSON.stringify(prevMigPlanCore)) {
    return true;
  } else {
    return false;
  }
};

function* checkPlanStatus(action) {
  let planStatusComplete = false;
  let tries = 0;
  const TicksUntilTimeout = 10;
  while (!planStatusComplete) {
    if (tries < TicksUntilTimeout) {
      yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.Pending }));
      tries += 1;
      const getPlanResponse = yield call(getPlanSaga, action.planName);
      const updatedPlan = getPlanResponse.data;

      //diff current plan before setting
      const state: IReduxState = yield select();
      const { currentPlan } = state.plan;
      if (!currentPlan || isUpdatedPlan(updatedPlan, currentPlan)) {
        yield put(PlanActions.setCurrentPlan(updatedPlan));
      }
      if (updatedPlan.status && updatedPlan.status.conditions) {
        const hasReadyCondition = !!updatedPlan.status.conditions.some((c) => c.type === 'Ready');
        const hasErrorCondition = !!updatedPlan.status.conditions.some((cond) => {
          return cond.category === 'Error';
        });
        const hasWarnCondition = !!updatedPlan.status.conditions.some((cond) => {
          return cond.category === 'Warn';
        });
        const hasCriticalCondition = !!updatedPlan.status.conditions.some((cond) => {
          return cond.category === 'Critical';
        });
        const hasConflictCondition = !!updatedPlan.status.conditions.some((cond) => {
          return cond.type === 'PlanConflict';
        });
        if (hasReadyCondition) {
          if (hasWarnCondition) {
            const warnCondition = updatedPlan.status.conditions.find((cond) => {
              return cond.category === 'Warn';
            });
            yield put(
              PlanActions.updateCurrentPlanStatus({
                state: CurrentPlanState.Warn,
                warnMessage: warnCondition.message,
              })
            );
          } else {
            yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.Ready }));
          }
          yield put(PlanActions.stopPlanStatusPolling(action.planName));
        }
        if (hasCriticalCondition) {
          const criticalCond = updatedPlan.status.conditions.find((cond) => {
            return cond.category === 'Critical';
          });
          yield put(
            PlanActions.updateCurrentPlanStatus({
              state: CurrentPlanState.Critical,
              errorMessage: criticalCond.message,
            })
          );

          yield put(PlanActions.stopPlanStatusPolling(action.planName));
        }
        if (hasErrorCondition) {
          const errorCond = updatedPlan.status.conditions.find((cond) => {
            return cond.category === 'Error';
          });
          yield put(
            PlanActions.updateCurrentPlanStatus({
              state: CurrentPlanState.Critical,
              errorMessage: errorCond.message,
            })
          );

          yield put(PlanActions.stopPlanStatusPolling(action.planName));
        }

        if (hasConflictCondition) {
          const conflictCond = updatedPlan.status.conditions.find((cond) => {
            return cond.type === 'PlanConflict';
          });
          yield put(
            PlanActions.updateCurrentPlanStatus({
              state: CurrentPlanState.Critical,
              errorMessage: conflictCond.message,
            })
          );

          yield put(PlanActions.stopPlanStatusPolling(action.planName));
        }
      }
    } else {
      planStatusComplete = true;
      yield put(PlanActions.updateCurrentPlanStatus({ state: CurrentPlanState.TimedOut }));
      yield put(PlanActions.stopPlanStatusPolling(action.planName));
      break;
    }

    const PollingInterval = 5000;
    yield delay(PollingInterval);
  }
}

function* planCloseSaga(action) {
  try {
    const updatedValues = {
      planName: action.planName,
      planClosed: true,
      persistentVolumes: [],
    };
    yield retry(
      PlanUpdateTotalTries,
      PlanUpdateRetryPeriodSeconds * 1000,
      planPatchClose,
      updatedValues
    );
  } catch (err) {
    yield put(PlanActions.planCloseFailure(err, action.planName));
    yield put(alertErrorTimeout('Plan close request failed'));
  }
}

function* planDeleteAfterClose(planName) {
  const state: IReduxState = yield select();
  const migMeta = state.auth.migMeta;
  const client: IClusterClient = ClientFactory.cluster(state);
  yield client.delete(new MigResource(MigResourceKind.MigPlan, migMeta.namespace), planName);
}

function* planCloseAndDelete(action) {
  try {
    yield call(planCloseSaga, action);
    yield call(checkClosedStatus, action);
    yield call(planDeleteAfterClose, action.planName);
    yield put(PlanActions.deleteAnalyticRequest(action.planName));
    yield put(PlanActions.planCloseAndDeleteSuccess(action.planName));
    yield put(alertSuccessTimeout(`Successfully removed plan "${action.planName}"!`));
  } catch (err) {
    yield put(PlanActions.planCloseAndDeleteFailure(err, action.planName));
    yield put(alertErrorTimeout(`Plan delete request failed for plan "${action.planName}"`));
  }
}

function* getPVResourcesRequest(action) {
  const state: IReduxState = yield select();
  const discoveryClient: IDiscoveryClient = ClientFactory.discovery(state);
  try {
    const pvResourceRefs = action.pvList.map((pv) => {
      const persistentVolume = new PersistentVolumeDiscovery(pv.name, action.clusterName);
      return discoveryClient.get(persistentVolume);
    });

    const pvList = [];
    yield Q.allSettled(pvResourceRefs).then((results) => {
      results.forEach((result) => {
        if (result.state === 'fulfilled') {
          pvList.push(result.value.data);
        }
      });
    });
    yield put(PlanActions.getPVResourcesSuccess(pvList));
  } catch (err) {
    if (utils.isTimeoutError(err)) {
      yield put(alertErrorTimeout('Timed out while fetching namespaces'));
    }
    yield put(PlanActions.getPVResourcesFailure('Failed to get pv details'));
  }
}

/******************************************************************** */
/* Stage sagas */
/******************************************************************** */

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
    const groupedPlan = planUtils.groupPlan(plan, migrationListResponse);

    const params = {
      fetchPlansGenerator: fetchPlansGenerator,
      delay: PlanMigrationPollingInterval,
      getStageStatusCondition: getStageStatusCondition,
      createMigRes: createMigRes,
    };

    yield put(PlanActions.startStagePolling(params));
    yield put(PlanActions.updatePlanMigrations(groupedPlan));
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

/******************************************************************** */
/* Migration sagas */
/******************************************************************** */

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
    yield put(PlanActions.initMigration(plan.MigPlan.metadata.name));
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
    const groupedPlan = planUtils.groupPlan(plan, migrationListResponse);

    const params = {
      fetchPlansGenerator: fetchPlansGenerator,
      delay: PlanMigrationPollingInterval,
      getMigrationStatusCondition: getMigrationStatusCondition,
      createMigRes: createMigRes,
    };

    yield put(PlanActions.startMigrationPolling(params));
    yield put(PlanActions.updatePlanMigrations(groupedPlan));
  } catch (err) {
    yield put(alertErrorTimeout(err));
    yield put(PlanActions.migrationFailure(err));
  }
}
function* migrationPoll(action) {
  const params = { ...action.params };
  while (true) {
    const updatedPlans = yield call(params.fetchPlansGenerator);
    const pollingStatusObj = params.getMigrationStatusCondition(updatedPlans, params.createMigRes);

    switch (pollingStatusObj.status) {
      case 'CANCELED':
        yield put(alertSuccessTimeout('Migration canceled'));
        yield put(PlanActions.stopMigrationPolling());
        break;
      case 'SUCCESS':
        yield put(PlanActions.migrationSuccess(pollingStatusObj.planName));
        yield put(alertSuccessTimeout('Migration Successful'));
        yield put(PlanActions.stopMigrationPolling());
        break;
      case 'FAILURE':
        yield put(PlanActions.migrationFailure(pollingStatusObj.error));
        yield put(alertErrorTimeout(`${pollingStatusObj.errorMessage || 'Migration Failed'}`));
        yield put(PlanActions.stopMigrationPolling());
        break;
      case 'WARN':
        yield put(PlanActions.migrationFailure(pollingStatusObj.error));
        yield put(alertWarn(`Migration succeeded with warnings. ${pollingStatusObj.errorMessage}`));
        yield put(PlanActions.stopMigrationPolling());
        break;

      default:
        break;
    }
    yield delay(params.delay);
  }
}

/******************************************************************** */
//Rollback sagas
/******************************************************************** */
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
    const groupedPlan = planUtils.groupPlan(plan, migrationListResponse);

    const params = {
      fetchPlansGenerator: fetchPlansGenerator,
      delay: PlanMigrationPollingInterval,
      getRollbackStatusCondition: getRollbackStatusCondition,
      createMigRes: createMigRes,
    };

    yield put(PlanActions.startRollbackPolling(params));
    yield put(PlanActions.updatePlanMigrations(groupedPlan));
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
//Hooks sagas
/******************************************************************** */

function* fetchHooksGenerator() {
  const state = yield select();
  const client: IClusterClient = ClientFactory.cluster(state);
  const resource = new MigResource(MigResourceKind.MigHook, state.auth.migMeta.namespace);
  try {
    let hookList = yield client.list(resource);
    hookList = yield hookList.data.items;

    return { updatedHooks: hookList };
  } catch (e) {
    throw e;
  }
}

function* fetchPlanHooksSaga() {
  const state: IReduxState = yield select();
  try {
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);
    const migHookResource = new MigResource(MigResourceKind.MigHook, migMeta.namespace);
    const { currentPlan } = state.plan;
    const getPlanRes = yield call(getPlanSaga, currentPlan.metadata.name);
    const currentPlanHooks = getPlanRes.data.spec.hooks;

    const hookList = yield client.list(migHookResource);
    const associatedHooks = [];
    if (currentPlanHooks) {
      currentPlanHooks.forEach((currentPlanHookRef) =>
        hookList.data.items.forEach((hookRef) => {
          if (currentPlanHookRef.reference.name === hookRef.metadata.name) {
            const uiHookObject = planUtils.convertMigHookToUIObject(currentPlanHookRef, hookRef);
            associatedHooks.push(uiHookObject);
          }
        })
      );
    }
    yield put(PlanActions.fetchPlanHooksSuccess(associatedHooks));
  } catch (err) {
    yield put(PlanActions.fetchPlanHooksFailure());
    yield put(alertErrorTimeout('Failed to fetch hooks'));
  }
}

function* updatePlanHookListSaga(action) {
  const state: IReduxState = yield select();
  const { migMeta } = state.auth;
  const { currentPlan } = state.plan;
  const client: IClusterClient = ClientFactory.cluster(state);
  const { currentPlanHookRefPatch } = action;
  if (currentPlanHookRefPatch) {
    const patchPlanResponse = yield client.patch(
      new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
      currentPlan.metadata.name,
      currentPlanHookRefPatch
    );
    yield put(PlanActions.setCurrentPlan(patchPlanResponse.data));
  }
  yield put(PlanActions.fetchPlanHooksRequest());
}

function* associateHookToPlanSaga(action) {
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const client: IClusterClient = ClientFactory.cluster(state);
    const { hookValues, migHook } = action;

    // associate  hook to plan
    const { currentPlan } = state.plan;
    const getPlanRes = yield call(getPlanSaga, currentPlan.metadata.name);
    const currentPlanSpec = getPlanRes.data.spec;

    const createHooksSpec = () => {
      const updatedSpec = Object.assign({}, currentPlanSpec);

      const getServiceAccountNamespace = (clusterType) => {
        if (clusterType === 'source') {
          return hookValues.srcServiceAccountNamespace;
        }
        if (clusterType === 'destination') {
          return hookValues.destServiceAccountNamespace;
        }
      };

      const getServiceAccountName = (clusterType) => {
        if (clusterType === 'source') {
          return hookValues.srcServiceAccountName;
        }
        if (clusterType === 'destination') {
          return hookValues.destServiceAccountName;
        }
      };
      const executionNamespace = getServiceAccountNamespace(hookValues.clusterType);
      const { name, namespace } = migHook.metadata;

      const newHook = {
        executionNamespace: executionNamespace,
        phase: hookValues.migrationStep,
        reference: {
          name: name,
          namespace: namespace,
        },
        serviceAccount: getServiceAccountName(hookValues.clusterType),
      };

      if (updatedSpec.hooks) {
        const isExistingPhase = updatedSpec.hooks.some((hook) => {
          hook.phase === hookValues.migrationStep;
        });
        if (!isExistingPhase) {
          updatedSpec.hooks.push(newHook);
        }
      } else {
        updatedSpec.hooks = [newHook];
      }

      const updatedHooksSpec = {
        spec: updatedSpec,
      };
      return updatedHooksSpec;
    };

    const patchPlanRes = yield client.patch(
      new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
      currentPlan?.metadata.name,
      createHooksSpec()
    );
    yield put(PlanActions.setCurrentPlan(patchPlanRes.data));
    yield put(PlanActions.fetchPlanHooksRequest());

    yield take(PlanActionTypes.FETCH_PLAN_HOOKS_SUCCESS);
    yield put(PlanActions.associateHookToPlanSuccess());
  } catch (err) {
    yield put(PlanActions.associateHookToPlanFailure());
    yield put(PlanActions.addHookFailure(err));
    yield put(alertErrorTimeout('Failed to add hook.'));
  }
}

function* addHookSaga(action) {
  const { migHook } = action;
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const { currentPlan } = state.plan;
    const client: IClusterClient = ClientFactory.cluster(state);

    const migHookObj = createMigHook(migHook, migMeta.namespace);
    const createHookRes = yield client.create(
      new MigResource(MigResourceKind.MigHook, migMeta.namespace),
      migHookObj
    );
    //If in HookStep, associate the hook to the currentPlan
    if (currentPlan) {
      yield put(PlanActions.associateHookToPlan(migHook, createHookRes.data));
    }
    const updatedHooks = yield call(fetchHooksGenerator);
    yield put(PlanActions.updateHooks(updatedHooks.updatedHooks));
    yield put(alertSuccessTimeout('Successfully added a hook to plan.'));
    yield put(PlanActions.addHookSuccess(createHookRes.data));
  } catch (err) {
    yield put(PlanActions.addHookFailure(err));
    yield put(alertErrorTimeout('Failed to add hook.'));
  }
}

function* removeHookFromPlanSaga(action) {
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const { name } = action;
    const client: IClusterClient = ClientFactory.cluster(state);

    const { currentPlan } = state.plan;

    const createHooksSpec = () => {
      const updatedSpec = Object.assign({}, currentPlan.spec);
      if (updatedSpec.hooks) {
        const deletedHookIndex = updatedSpec.hooks.findIndex(
          (hook) => hook.reference.name === name
        );
        updatedSpec.hooks.splice(deletedHookIndex, 1);
      }

      const updatedHooksSpec = {
        spec: updatedSpec,
      };
      return updatedHooksSpec;
    };

    const patchPlanRes = yield client.patch(
      new MigResource(MigResourceKind.MigPlan, migMeta.namespace),
      currentPlan.metadata.name,
      createHooksSpec()
    );

    yield put(alertSuccessTimeout(`Successfully removed hook from plan"${name}"!`));
    yield put(PlanActions.removeHookFromPlanSuccess(name));
    yield put(PlanActions.setCurrentPlan(patchPlanRes.data));
    yield put(PlanActions.fetchPlanHooksRequest());
  } catch (err) {
    yield put(alertErrorTimeout(err));
    yield put(PlanActions.removeHookFromPlanFailure(err));
  }
}

function* removeHookSaga(action) {
  try {
    const state: IReduxState = yield select();
    const { migMeta } = state.auth;
    const { name } = action;
    const client: IClusterClient = ClientFactory.cluster(state);

    const migHookResource = new MigResource(MigResourceKind.MigHook, migMeta.namespace);

    yield client.delete(migHookResource, name);

    const updatedHooks = yield call(fetchHooksGenerator);
    yield put(PlanActions.updateHooks(updatedHooks.updatedHooks));
    yield put(alertSuccessTimeout(`Successfully removed hook "${name}"!`));
    yield put(PlanActions.removeHookSuccess(name));
  } catch (err) {
    yield put(alertErrorTimeout(err));
    yield put(PlanActions.removeHookFailure(err));
  }
}

function* updateHookRequest(action) {
  const state: IReduxState = yield select();
  const { migMeta } = state.auth;
  const { migHook } = action;
  const client: IClusterClient = ClientFactory.cluster(state);
  const { currentPlan } = state.plan;

  let currentHook;
  if (currentPlan) {
    currentHook = state.plan?.currentPlanHooks.find((hook) => {
      return hook?.hookName === migHook?.hookName;
    });
  } else {
    currentHook = state.plan?.allHooks.find((hook) => {
      return hook.metadata.name === migHook?.hookName;
    });
  }

  try {
    const migHookPatch = updateMigHook(currentHook, migHook);
    yield client.patch(
      new MigResource(MigResourceKind.MigHook, migMeta.namespace),
      migHook.hookName,
      migHookPatch
    );
    const updatedHooks = yield call(fetchHooksGenerator);
    yield put(PlanActions.updateHooks(updatedHooks.updatedHooks));

    if (currentPlan) {
      const currentPlanHookRef = currentPlan?.spec?.hooks.find((hook) => {
        return hook.reference.name === migHook.hookName;
      });
      const currentPlanHookRefPatch = updatePlanHookList(
        currentHook,
        migHook,
        currentPlanHookRef,
        migMeta.namespace,
        currentPlan
      );
      yield put(PlanActions.updatePlanHookList(currentPlanHookRefPatch));
    }

    yield put(alertSuccessTimeout('Successfully updated hook.'));
    yield put(
      PlanActions.setHookAddEditStatus(createAddEditStatus(AddEditState.Ready, AddEditMode.Add))
    );
    if (currentPlan) {
      yield take(PlanActionTypes.FETCH_PLAN_HOOKS_SUCCESS);
      yield put(PlanActions.updateHookSuccess());
    } else {
      yield put(PlanActions.updateHookSuccess());
    }
  } catch (err) {
    yield put(PlanActions.updateHookFailure());
    yield put(alertErrorTimeout('Failed to update hook.'));
    throw err;
  }
}

/******************************************************************** */
/* Saga watchers */
/******************************************************************** */

function* watchUpdateHookRequest() {
  yield takeLatest(PlanActionTypes.UPDATE_HOOK_REQUEST, updateHookRequest);
}

function* watchRemoveHookRequest() {
  yield takeLatest(PlanActionTypes.REMOVE_HOOK_REQUEST, removeHookSaga);
}

function* watchRemoveHookFromPlanRequest() {
  yield takeLatest(PlanActionTypes.REMOVE_HOOK_FROM_PLAN_REQUEST, removeHookFromPlanSaga);
}

function* watchFetchPlanHooksRequest() {
  yield takeLatest(PlanActionTypes.FETCH_PLAN_HOOKS_REQUEST, fetchPlanHooksSaga);
}

function* watchAddHookRequest() {
  yield takeLatest(PlanActionTypes.ADD_HOOK_REQUEST, addHookSaga);
}

function* watchStagePolling() {
  while (true) {
    const data = yield take(PlanActionTypes.STAGE_POLL_START);
    yield race([call(stagePoll, data), take(PlanActionTypes.STAGE_POLL_STOP)]);
  }
}

function* watchMigrationPolling() {
  while (true) {
    const data = yield take(PlanActionTypes.MIGRATION_POLL_START);
    yield race([call(migrationPoll, data), take(PlanActionTypes.MIGRATION_POLL_STOP)]);
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

function* watchPlanCloseAndDelete() {
  yield takeEvery(PlanActionTypes.PLAN_CLOSE_AND_DELETE_REQUEST, planCloseAndDelete);
}

function* watchPlanStatus() {
  while (true) {
    const data = yield take(PlanActionTypes.PLAN_STATUS_POLL_START);
    yield race([call(checkPlanStatus, data), take(PlanActionTypes.PLAN_STATUS_POLL_STOP)]);
  }
}

function* watchPvDiscoveryRequest() {
  yield takeEvery(PlanActionTypes.PV_DISCOVERY_REQUEST, pvDiscoveryRequest);
}

function* watchPVUpdatePolling() {
  while (true) {
    const data = yield take(PlanActionTypes.PV_UPDATE_POLL_START);
    yield race([call(pvUpdatePoll, data), take(PlanActionTypes.PV_UPDATE_POLL_STOP)]);
  }
}

function* watchGetPVResourcesRequest() {
  yield takeLatest(PlanActionTypes.GET_PV_RESOURCES_REQUEST, getPVResourcesRequest);
}

function* watchNamespaceFetchRequest() {
  yield takeLatest(PlanActionTypes.NAMESPACE_FETCH_REQUEST, namespaceFetchRequest);
}

function* watchAddAnalyticRequest() {
  yield takeLatest(PlanActionTypes.ADD_ANALYTIC_REQUEST, addAnalyticSaga);
}

function* watchDeleteAnalyticRequest() {
  yield takeLatest(PlanActionTypes.DELETE_ANALYTIC_REQUEST, deleteAnalyticSaga);
}

function* watchAddPlanRequest() {
  yield takeLatest(PlanActionTypes.ADD_PLAN_REQUEST, addPlanSaga);
}

function* watchRunMigrationRequest() {
  yield takeLatest(PlanActionTypes.RUN_MIGRATION_REQUEST, runMigrationSaga);
}

function* watchRunStageRequest() {
  yield takeLatest(PlanActionTypes.RUN_STAGE_REQUEST, runStageSaga);
}

function* watchRunRollbackRequest() {
  yield takeLatest(PlanActionTypes.RUN_ROLLBACK_REQUEST, runRollbackSaga);
}

function* watchValidatePlanPolling() {
  while (true) {
    const data = yield take(PlanActionTypes.VALIDATE_PLAN_POLL_START);
    yield race([call(validatePlanPoll, data), take(PlanActionTypes.VALIDATE_PLAN_POLL_STOP)]);
  }
}

function* watchValidatePlanRequest() {
  yield takeLatest(PlanActionTypes.VALIDATE_PLAN_REQUEST, validatePlanSaga);
}

function* watchRefreshAnalyticRequest() {
  while (true) {
    const data = yield take(PlanActionTypes.REFRESH_ANALYTIC_REQUEST);
    yield race([
      call(refreshAnalyticSaga, data),
      take([PlanActionTypes.REFRESH_ANALYTIC_SUCCESS, PlanActionTypes.REFRESH_ANALYTIC_FAILURE]),
    ]);
  }
}

function* watchAssociateHookToPlan() {
  yield takeLatest(PlanActionTypes.ASSOCIATE_HOOK_TO_PLAN, associateHookToPlanSaga);
}

function* watchUpdatePlanHookList() {
  yield takeLatest(PlanActionTypes.UPDATE_PLAN_HOOK_LIST, updatePlanHookListSaga);
}

export default {
  watchStagePolling,
  watchMigrationPolling,
  watchRollbackPolling,
  fetchHooksGenerator,
  fetchPlansGenerator,
  watchRunStageRequest,
  watchRunMigrationRequest,
  watchRunRollbackRequest,
  watchAddPlanRequest,
  watchAddAnalyticRequest,
  watchDeleteAnalyticRequest,
  watchRefreshAnalyticRequest,
  watchPvDiscoveryRequest,
  watchPlanCloseAndDelete,
  watchPlanStatus,
  watchMigrationCancel,
  watchGetPVResourcesRequest,
  watchNamespaceFetchRequest,
  watchPVUpdatePolling,
  watchAddHookRequest,
  watchFetchPlanHooksRequest,
  watchRemoveHookRequest,
  watchRemoveHookFromPlanRequest,
  watchUpdateHookRequest,
  watchValidatePlanRequest,
  watchValidatePlanPolling,
  watchAssociateHookToPlan,
  watchUpdatePlanHookList,
};
