import * as React from 'react';
import { useDispatch } from 'react-redux';
import { clusterSagas } from '../../cluster/duck';
import { ClusterActions } from '../../cluster/duck/actions';
import { PlanActions, planSagas } from '../../plan/duck';
import { storageSagas } from '../../storage/duck';
import { StorageActions } from '../../storage/duck/actions';
import { StatusPollingInterval } from '../duck/sagas';
export interface IPollingParams {
  asyncFetch: any;
  callback: (response: any) => boolean;
  delay: number;
  retryOnFailure: boolean;
  retryAfter: number;
  stopAfterRetries: number;
  pollName: string;
}
interface IPollingContext {
  isPollingEnabled: boolean;
  pauseIrrelevantPolling: () => void;
  pausePolling: () => void;
  resumePolling: () => void;
  startDefaultClusterPolling: () => void;
  startDefaultStoragePolling: () => void;
  startDefaultPlanPolling: () => void;
  startDefaultHookPolling: () => void;
  stopHookPolling: () => void;
  stopClusterPolling: () => void;
  stopStoragePolling: () => void;
  stopPlanPolling: () => void;
}

const PollingContext = React.createContext<IPollingContext>({
  isPollingEnabled: true,
  pauseIrrelevantPolling: () => undefined,
  pausePolling: () => undefined,
  resumePolling: () => undefined,
  startDefaultClusterPolling: () => undefined,
  startDefaultStoragePolling: () => undefined,
  startDefaultPlanPolling: () => undefined,
  startDefaultHookPolling: () => undefined,
  stopHookPolling: () => undefined,
  stopClusterPolling: () => undefined,
  stopStoragePolling: () => undefined,
  stopPlanPolling: () => undefined,
});

interface IPollingContextProviderProps {
  children: React.ReactNode;
}

export const PollingContextProvider: React.FunctionComponent<IPollingContextProviderProps> = ({
  children,
}: IPollingContextProviderProps) => {
  const [isPollingEnabled, setIsPollingEnabled] = React.useState(true);
  const dispatch = useDispatch();

  const handlePlanPoll = (response: any) => {
    if (response) {
      dispatch(PlanActions.updatePlans(response.updatedPlans));
      return true;
    }
    return false;
  };

  const handleClusterPoll = (response: any) => {
    if (response) {
      dispatch(ClusterActions.updateClusters(response.updatedClusters));
      return true;
    }
    return false;
  };

  const handleStoragePoll = (response: any) => {
    if (response) {
      dispatch(StorageActions.updateStorages(response.updatedStorages));
      return true;
    }
    return false;
  };

  const handleHookPoll = (response: any) => {
    if (response) {
      dispatch(PlanActions.updateHooks(response.updatedHooks));
      return true;
    }
    return false;
  };

  const startDefaultPlanPolling = () => {
    const planPollParams: IPollingParams = {
      asyncFetch: planSagas.fetchPlansGenerator,
      callback: handlePlanPoll,
      delay: StatusPollingInterval,
      retryOnFailure: true,
      retryAfter: 5,
      stopAfterRetries: 2,
      pollName: 'Plan',
    };
    dispatch(PlanActions.startPlanPolling(planPollParams));
  };

  const startDefaultClusterPolling = () => {
    const clusterPollParams: IPollingParams = {
      asyncFetch: clusterSagas.fetchClustersGenerator,
      callback: handleClusterPoll,
      delay: StatusPollingInterval,
      retryOnFailure: true,
      retryAfter: 5,
      stopAfterRetries: 2,
      pollName: 'Cluster',
    };
    dispatch(ClusterActions.startClusterPolling(clusterPollParams));
  };

  const startDefaultStoragePolling = () => {
    const storagePollParams: IPollingParams = {
      asyncFetch: storageSagas.fetchStorageGenerator,
      callback: handleStoragePoll,
      delay: StatusPollingInterval,
      retryOnFailure: true,
      retryAfter: 5,
      stopAfterRetries: 2,
      pollName: 'Storage',
    };
    dispatch(StorageActions.startStoragePolling(storagePollParams));
  };

  const startDefaultHookPolling = () => {
    const hookPollParams: IPollingParams = {
      asyncFetch: planSagas.fetchHooksGenerator,
      callback: handleHookPoll,
      delay: StatusPollingInterval,
      retryOnFailure: true,
      retryAfter: 5,
      stopAfterRetries: 2,
      pollName: 'Hook',
    };
    dispatch(PlanActions.startHookPolling(hookPollParams));
  };
  React.useEffect(() => {
    startDefaultClusterPolling();
    startDefaultStoragePolling();
    startDefaultPlanPolling();
    startDefaultHookPolling();
  }, []);

  return (
    <PollingContext.Provider
      value={{
        isPollingEnabled,
        startDefaultClusterPolling: () => startDefaultClusterPolling(),
        startDefaultStoragePolling: () => startDefaultStoragePolling(),
        startDefaultPlanPolling: () => startDefaultPlanPolling(),
        startDefaultHookPolling: () => startDefaultHookPolling(),
        stopHookPolling: () => dispatch(PlanActions.stopHookPolling()),
        stopClusterPolling: () => dispatch(ClusterActions.stopClusterPolling()),
        stopStoragePolling: () => dispatch(StorageActions.stopStoragePolling()),
        stopPlanPolling: () => dispatch(PlanActions.stopPlanPolling()),
        resumePolling: () => {
          if (!isPollingEnabled) {
            startDefaultClusterPolling();
            startDefaultStoragePolling();
            startDefaultPlanPolling();
            startDefaultHookPolling();
            setIsPollingEnabled(true);
          }
        },
        pausePolling: () => {
          if (isPollingEnabled) {
            dispatch(ClusterActions.stopClusterPolling());
            dispatch(StorageActions.stopStoragePolling());
            dispatch(PlanActions.stopPlanPolling());
            dispatch(PlanActions.stopHookPolling());
            setIsPollingEnabled(false);
          }
        },
        pauseIrrelevantPolling: () => {
          if (isPollingEnabled) {
            dispatch(ClusterActions.stopClusterPolling());
            dispatch(StorageActions.stopStoragePolling());
            dispatch(PlanActions.stopHookPolling());
            setIsPollingEnabled(false);
          }
        },
      }}
    >
      {children}
    </PollingContext.Provider>
  );
};

export const usePollingContext = (): IPollingContext => React.useContext(PollingContext);

export const usePausedPollingEffect = (): void => {
  const { pausePolling, resumePolling } = usePollingContext();
  React.useEffect(() => {
    pausePolling();
    return resumePolling;
  }, [pausePolling, resumePolling]);
};

export const useDebugViewPollingEffect = (): void => {
  const { pausePolling, resumePolling, pauseIrrelevantPolling, startDefaultPlanPolling } =
    usePollingContext();
  React.useEffect(() => {
    pauseIrrelevantPolling();
    return resumePolling;
  }, [pausePolling, resumePolling]);
};
