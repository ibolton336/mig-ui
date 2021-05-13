import { createSelector } from 'reselect';

const debugRefsSelector = (state) => state.debug.debugRefs.map((r) => r);

export default {
  debugRefsSelector,
};
