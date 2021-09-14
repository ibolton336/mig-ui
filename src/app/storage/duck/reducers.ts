import { fetchingAddEditStatus, IAddEditStatus } from '../../common/add_edit_state';
import { StorageActionTypes } from './actions';
import { defaultAddEditStatus } from '../../common/add_edit_state';
import { IStorage } from './types';

export interface IStorageReducerState {
  isPolling: boolean;
  isFetching: boolean;
  isError: boolean;
  isLoadingStorage: boolean;
  migStorageList: IStorage[];
  searchTerm: string;
  addEditStatus: IAddEditStatus;
  isFetchingInitialStorages: boolean;
  currentStorage: IStorage;
}

type StorageReducerFn = (state: IStorageReducerState, action: any) => IStorageReducerState;

export const INITIAL_STATE: IStorageReducerState = {
  isPolling: false,
  isFetching: false,
  isError: false,
  isLoadingStorage: false,
  migStorageList: [],
  searchTerm: '',
  addEditStatus: defaultAddEditStatus(),
  isFetchingInitialStorages: true,
  currentStorage: null,
};

export const setCurrentStorage: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    currentStorage: action.currentStorage,
  };
};

export const migStorageFetchRequest: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return { ...state, isFetching: true };
};

export const migStorageFetchSuccess: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    isFetching: false,
    isFetchingInitialStorages: false,
    isError: false,
  };
};
export const migStorageFetchFailure: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    isError: true,
    isFetching: false,
    isFetchingInitialStorages: false,
  };
};

export const addStorageRequest: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    addEditStatus: fetchingAddEditStatus(),
    isLoadingStorage: true,
  };
};
export const addStorageSuccess: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    migStorageList: [...state.migStorageList, action.newStorage],
    isLoadingStorage: false,
  };
};
export const removeStorageSuccess: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    migStorageList: state.migStorageList.filter(
      (item) => item.MigStorage.metadata.name !== action.name
    ),
  };
};
export const updateSearchTerm: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return { ...state, searchTerm: action.searchTerm };
};

export const updateStorageRequest: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    addEditStatus: fetchingAddEditStatus(),
    isLoadingStorage: true,
  };
};

export const updateStorageSuccess: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    migStorageList: [
      ...state.migStorageList.filter(
        (s) => s.MigStorage.metadata.name !== action.updatedStorage.MigStorage.metadata.name
      ),
      { ...action.updatedStorage },
    ],
    isLoadingStorage: false,
  };
};

export const updateStorages: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    isFetchingInitialStorages: false,
    migStorageList: action.updatedStorages,
  };
};

export const setStorageAddEditStatus: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    addEditStatus: action.status,
  };
};

export const startStoragePolling: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    isPolling: true,
  };
};

export const stopStoragePolling: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    isPolling: false,
  };
};

export const resetStoragePage: StorageReducerFn = (state = INITIAL_STATE, action) => {
  return {
    ...state,
    isFetchingInitialStorages: true,
  };
};

const storageReducer: StorageReducerFn = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case StorageActionTypes.MIG_STORAGE_FETCH_REQUEST:
      return migStorageFetchRequest(state, action);
    case StorageActionTypes.MIG_STORAGE_FETCH_SUCCESS:
      return migStorageFetchSuccess(state, action);
    case StorageActionTypes.MIG_STORAGE_FETCH_FAILURE:
      return migStorageFetchFailure(state, action);
    case StorageActionTypes.ADD_STORAGE_REQUEST:
      return addStorageRequest(state, action);
    case StorageActionTypes.ADD_STORAGE_SUCCESS:
      return addStorageSuccess(state, action);
    case StorageActionTypes.UPDATE_STORAGES:
      return updateStorages(state, action);
    case StorageActionTypes.UPDATE_STORAGE_REQUEST:
      return updateStorageRequest(state, action);
    case StorageActionTypes.UPDATE_STORAGE_SUCCESS:
      return updateStorageSuccess(state, action);
    case StorageActionTypes.REMOVE_STORAGE_SUCCESS:
      return removeStorageSuccess(state, action);
    case StorageActionTypes.UPDATE_SEARCH_TERM:
      return updateSearchTerm(state, action);
    case StorageActionTypes.SET_STORAGE_ADD_EDIT_STATUS:
      return setStorageAddEditStatus(state, action);
    case StorageActionTypes.STORAGE_POLL_START:
      return startStoragePolling(state, action);
    case StorageActionTypes.STORAGE_POLL_STOP:
      return stopStoragePolling(state, action);
    case StorageActionTypes.RESET_STORAGE_PAGE:
      return resetStoragePage(state, action);
    case StorageActionTypes.SET_CURRENT_STORAGE:
      return setCurrentStorage(state, action);
    default:
      return state;
  }
};

export default storageReducer;
