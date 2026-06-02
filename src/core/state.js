export const state = {
  currentRole: null,
  currentGroupId: null,
  viewAsRole: null,  // owner can preview any role's dashboard
};

/** Returns viewAsRole when owner is previewing, otherwise currentRole */
export function effectiveRole() {
  return state.viewAsRole || state.currentRole || {};
}
