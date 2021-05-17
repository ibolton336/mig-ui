import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import dayjs from 'dayjs';
import { IMigration, IPlan } from '../../duck/types';

export interface IRunMigrationRequest {
  plan: IPlan;
  enableQuiesce: boolean;
}
export interface IMigrationReducerState {
  state: any;
  migrationList: any;
  isPolling: boolean;
}

const initialState = {
  migrationList: [],
  state: null,
  isPolling: false,
} as IMigrationReducerState;

const migrationSlice = createSlice({
  name: 'migration',
  initialState,
  reducers: {
    updateMigrations(state, action: PayloadAction<string>) {
      state.migrationList = action.payload;
    },
    initStage(state, action: PayloadAction<any>) {
      //N/A
    },
    initMigration(state, action: PayloadAction<any>) {
      //N/A
    },
    initRollback(state, action: PayloadAction<any>) {
      //N/A
    },
    stagingSuccess(state, action: PayloadAction<any>) {
      //N/A
    },
    stagingFailure(state, action: PayloadAction<any>) {
      //N/A
    },
    migrationSuccess(state, action: PayloadAction<any>) {
      //N/A
    },
    migrationFailure(state, action: PayloadAction<any>) {
      //N/A
    },
    createMigrationRequest(state, action: PayloadAction<any>) {
      //associated plan = action.payload
      //N/A
    },
    createMigrationSuccess(state, action: PayloadAction<any>) {
      //migration response = action.payload
      //N/A
    },
    createMigrationFailure(state, action: PayloadAction<any>) {
      //migration error = action.payload
      //N/A
    },
    startMigrationPolling(state, action: PayloadAction<any>) {
      state.isPolling = true;
      //N/A
    },
    stopMigrationPolling(state) {
      state.isPolling = false;
      //N/A
    },
    runMigrationRequest(state, action: PayloadAction<IRunMigrationRequest>) {
      //NA plan, enableQuiesce
    },
  },
});

export const {
  updateMigrations,
  initMigration,
  initRollback,
  initStage,
  stagingFailure,
  stagingSuccess,
  migrationFailure,
  migrationSuccess,
  startMigrationPolling,
  stopMigrationPolling,
  runMigrationRequest,
  createMigrationFailure,
  createMigrationRequest,
  createMigrationSuccess,
} = migrationSlice.actions;
export default migrationSlice.reducer;
