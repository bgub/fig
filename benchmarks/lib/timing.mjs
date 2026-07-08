import { performance } from "node:perf_hooks";

export const defaultRows = [100, 1000];
export const defaultSamples = 7;
export const defaultTargetMs = 50;
export const defaultMaxIterations = 80;

export function createOperationCounts() {
  return {
    appendChild: 0,
    appendChildToContainer: 0,
    appendInitialChild: 0,
    clearContainer: 0,
    commitTextUpdate: 0,
    commitUpdate: 0,
    createInstance: 0,
    createTextInstance: 0,
    hideInstance: 0,
    hideTextInstance: 0,
    insertInContainerBefore: 0,
    insertBefore: 0,
    removeChild: 0,
    removeChildFromContainer: 0,
    resetTextContent: 0,
    unhideInstance: 0,
    unhideTextInstance: 0,
  };
}

export function createScenarioMetrics() {
  return {
    boundaryChecks: 0,
    componentRenders: 0,
    contextReads: 0,
    externalStoreReads: 0,
    externalStoreSnapshotReads: 0,
    payloadNodes: 0,
    serverSuspenseBoundaries: 0,
    storeNotifications: 0,
  };
}

export function measureSync(callback) {
  maybeGc();
  const start = performance.now();
  callback();
  return performance.now() - start;
}

export async function measureAsync(callback) {
  maybeGc();
  const start = performance.now();
  await callback();
  return performance.now() - start;
}

export function resetOperations(operations) {
  for (const key of Object.keys(operations)) operations[key] = 0;
}

export function resetMetrics(metrics) {
  for (const key of Object.keys(metrics)) metrics[key] = 0;
}

export function snapshotOperations(operations) {
  return { ...operations };
}

export function snapshotMetrics(metrics) {
  return { ...metrics };
}

export function operationTotal(operations) {
  return Object.values(operations).reduce((total, value) => total + value, 0);
}

function maybeGc() {
  if (typeof globalThis.gc === "function") globalThis.gc();
}
