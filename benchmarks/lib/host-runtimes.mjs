import { performance } from "node:perf_hooks";
import {
  Suspense as FigSuspense,
  ViewTransition as FigViewTransition,
  createContext as createFigContext,
  createElement as createFigElement,
  readContext as readFigContext,
  readPromise as readFigPromise,
  transition as figTransition,
  useSyncExternalStore as useFigSyncExternalStore,
  useState as useFigState,
} from "../../packages/fig/dist/index.js";
import { createRenderer as createFigRenderer } from "../../packages/fig-reconciler/dist/index.js";
import { createOperationCounts } from "./timing.mjs";

process.env.NODE_ENV ??= "production";

const React = await import("react");
const ReactReconcilerModule = await import("react-reconciler");
const createReactReconciler =
  ReactReconcilerModule.default ?? ReactReconcilerModule;
const {
  Suspense: ReactSuspense,
  createContext: createReactContext,
  createElement: createReactElement,
  use: useReactPromise,
  useContext: useReactContext,
  useSyncExternalStore: useReactSyncExternalStore,
  useState: useReactState,
} = React;

export { FigSuspense, createFigElement, readFigPromise };

class BenchText {
  parentNode = null;
  hidden = false;

  constructor(nodeValue) {
    this.nodeValue = nodeValue;
  }

  get textContent() {
    return this.hidden ? "" : this.nodeValue;
  }
}

class BenchElement {
  childNodes = [];
  parentNode = null;
  hidden = false;

  constructor(type) {
    this.type = type;
  }

  insertBefore(node, child) {
    node.parentNode?.removeChild(node);

    if (child === null) {
      this.childNodes.push(node);
    } else {
      const index = this.childNodes.indexOf(child);
      if (index === -1) this.childNodes.push(node);
      else this.childNodes.splice(index, 0, node);
    }

    node.parentNode = this;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  get textContent() {
    if (this.hidden) return "";
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];

    if (value !== "") {
      const text = new BenchText(value);
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }
}

export { BenchElement };

function buildTemplateNode(spec) {
  if (typeof spec === "string") return new BenchText(spec);
  const element = new BenchElement(spec.type);
  for (const child of spec.children ?? []) {
    const built = buildTemplateNode(child);
    element.childNodes.push(built);
    built.parentNode = element;
  }
  return element;
}

function cloneTemplateNode(node) {
  if (node instanceof BenchText) return new BenchText(node.nodeValue);
  const element = new BenchElement(node.type);
  for (const child of node.childNodes) {
    const clone = cloneTemplateNode(child);
    element.childNodes.push(clone);
    clone.parentNode = element;
  }
  return element;
}

function resolveTemplatePath(root, path) {
  let node = root;
  for (const index of path) node = node.childNodes[index];
  return node;
}

const templatePrototypes = new WeakMap();

function createFigBenchRenderer() {
  const operations = createOperationCounts();
  const host = {
    createInstance: (type) => {
      operations.createInstance += 1;
      return new BenchElement(type);
    },
    createTextInstance: (text) => {
      operations.createTextInstance += 1;
      return new BenchText(text);
    },
    // Bet-2 spike: descriptor = { spec, slotPaths } with text-only slots,
    // standing in for compiler output. The prototype is built once per
    // descriptor and cloned per instance — the in-memory analog of a
    // <template> element's cloneNode.
    createTemplateInstance: (descriptor, slots) => {
      operations.createTemplateInstance += 1;
      let prototype = templatePrototypes.get(descriptor);
      if (prototype === undefined) {
        prototype = buildTemplateNode(descriptor.spec);
        templatePrototypes.set(descriptor, prototype);
      }
      const instance = cloneTemplateNode(prototype);
      const slotNodes = descriptor.slotPaths.map((path) =>
        resolveTemplatePath(instance, path),
      );
      for (let index = 0; index < slotNodes.length; index += 1) {
        slotNodes[index].nodeValue = String(slots[index]);
      }
      instance.templateSlotNodes = slotNodes;
      return instance;
    },
    commitTemplateUpdate: (instance, _descriptor, previous, next) => {
      operations.commitTemplateUpdate += 1;
      const slotNodes = instance.templateSlotNodes;
      for (let index = 0; index < next.length; index += 1) {
        if (!Object.is(previous[index], next[index])) {
          slotNodes[index].nodeValue = String(next[index]);
        }
      }
    },
    appendInitialChild: (parent, child) => {
      operations.appendInitialChild += 1;
      parent.insertBefore(child, null);
    },
    finalizeInitialInstance: () => undefined,
    insertBefore: (parent, child, before) => {
      operations.insertBefore += 1;
      parent.insertBefore(child, before);
    },
    removeChild: (parent, child) => {
      operations.removeChild += 1;
      parent.removeChild(child);
    },
    hideInstance: (instance) => {
      operations.hideInstance += 1;
      instance.hidden = true;
    },
    unhideInstance: (instance) => {
      operations.unhideInstance += 1;
      instance.hidden = false;
    },
    hideTextInstance: (text) => {
      operations.hideTextInstance += 1;
      text.hidden = true;
    },
    unhideTextInstance: (text) => {
      operations.unhideTextInstance += 1;
      text.hidden = false;
    },
    commitUpdate: (instance, _previousProps, nextProps) => {
      operations.commitUpdate += 1;
      instance.props = nextProps;
    },
    commitTextUpdate: (text, value) => {
      operations.commitTextUpdate += 1;
      text.nodeValue = value;
    },
    viewTransition: {
      commit: (_container, prepare, mutate, cleanup) => {
        operations.commitViewTransition += 1;
        prepare();
        try {
          mutate();
          return "committed";
        } finally {
          cleanup();
        }
      },
      apply: (instance, name, className) => {
        operations.applyViewTransitionName += 1;
        instance.viewTransitionName = name;
        instance.viewTransitionClassName = className;
      },
      restore: (instance) => {
        operations.restoreViewTransitionName += 1;
        instance.viewTransitionName = null;
        instance.viewTransitionClassName = null;
      },
      measure: (instance) => {
        operations.measureViewTransitionSurface += 1;
        const parent = instance.parentNode;
        const index = parent?.childNodes.indexOf(instance) ?? 0;
        return {
          absolutelyPositioned: false,
          height: 1,
          inViewport: !instance.hidden,
          width: 1,
          x: 0,
          y: index,
        };
      },
      suspend: () => {
        operations.suspendViewTransition += 1;
        return false;
      },
    },
  };
  const renderer = createFigRenderer(host);

  return {
    createRoot: (container) =>
      renderer.createRoot(container, { devtools: false }),
    flushSync: renderer.flushSync,
    operations,
  };
}

function createReactBenchRenderer() {
  const operations = createOperationCounts();
  let currentUpdatePriority = 0;
  const host = {
    HostTransitionContext: {
      _currentValue: null,
      _currentValue2: null,
    },
    NotPendingTransition: null,
    appendChild: (parent, child) => {
      operations.appendChild += 1;
      parent.insertBefore(child, null);
    },
    appendChildToContainer: (container, child) => {
      operations.appendChildToContainer += 1;
      container.insertBefore(child, null);
    },
    appendInitialChild: (parent, child) => {
      operations.appendInitialChild += 1;
      parent.insertBefore(child, null);
    },
    bindToConsole: (method, args) => method.bind(console, ...args),
    cancelTimeout: clearTimeout,
    clearContainer: (container) => {
      operations.clearContainer += 1;
      container.textContent = "";
    },
    commitMount: () => undefined,
    commitTextUpdate: (text, _previousText, nextText) => {
      operations.commitTextUpdate += 1;
      text.nodeValue = String(nextText);
    },
    commitUpdate: (instance, _type, _previousProps, nextProps) => {
      operations.commitUpdate += 1;
      instance.props = nextProps;
    },
    createInstance: (type, props) => {
      operations.createInstance += 1;
      const instance = new BenchElement(type);
      instance.props = props;
      return instance;
    },
    createTextInstance: (text) => {
      operations.createTextInstance += 1;
      return new BenchText(String(text));
    },
    detachDeletedInstance: () => undefined,
    finalizeInitialChildren: () => false,
    findFiberRoot: () => null,
    getBoundingRect: () => ({ height: 0, width: 0, x: 0, y: 0 }),
    getChildHostContext: () => null,
    getCurrentUpdatePriority: () => currentUpdatePriority,
    getInstanceFromNode: () => null,
    getPublicInstance: (instance) => instance,
    getRootHostContext: () => null,
    getSuspendedCommitReason: () => null,
    getTextContent: (node) => node.textContent,
    hideInstance: (instance) => {
      operations.hideInstance += 1;
      instance.hidden = true;
    },
    hideTextInstance: (text) => {
      operations.hideTextInstance += 1;
      text.hidden = true;
    },
    insertBefore: (parent, child, before) => {
      operations.insertBefore += 1;
      parent.insertBefore(child, before);
    },
    insertInContainerBefore: (container, child, before) => {
      operations.insertInContainerBefore += 1;
      container.insertBefore(child, before);
    },
    isHiddenSubtree: (node) => node.hidden,
    isPrimaryRenderer: false,
    matchAccessibilityRole: () => false,
    maySuspendCommit: () => false,
    maySuspendCommitInSyncRender: () => false,
    maySuspendCommitOnUpdate: () => false,
    noTimeout: -1,
    preloadInstance: () => true,
    prepareForCommit: () => null,
    preparePortalMount: () => undefined,
    removeChild: (parent, child) => {
      operations.removeChild += 1;
      parent.removeChild(child);
    },
    removeChildFromContainer: (container, child) => {
      operations.removeChildFromContainer += 1;
      container.removeChild(child);
    },
    rendererPackageName: "fig-benchmark-react",
    rendererVersion: "0.0.0",
    resetAfterCommit: () => undefined,
    resetFormInstance: () => undefined,
    resetTextContent: (instance) => {
      operations.resetTextContent += 1;
      instance.textContent = "";
    },
    resolveEventTimeStamp: () => performance.now(),
    resolveEventType: () => null,
    // React uses this when setState is scheduled outside a browser event.
    // Keep benchmark state updates synchronous under flushSync.
    resolveUpdatePriority: () => 2,
    scheduleMicrotask: queueMicrotask,
    scheduleTimeout: setTimeout,
    setCurrentUpdatePriority: (priority) => {
      currentUpdatePriority = priority;
    },
    setFocusIfFocusable: () => false,
    setupIntersectionObserver: () => ({
      disconnect: () => undefined,
      observe: () => undefined,
      unobserve: () => undefined,
    }),
    shouldAttemptEagerTransition: () => false,
    shouldSetTextContent: () => false,
    startSuspendingCommit: () => undefined,
    supportsHydration: false,
    supportsMicrotasks: true,
    supportsMutation: true,
    supportsPersistence: false,
    supportsResources: false,
    supportsSingletons: false,
    supportsTestSelectors: false,
    suspendInstance: () => undefined,
    trackSchedulerEvent: () => undefined,
    unhideInstance: (instance) => {
      operations.unhideInstance += 1;
      instance.hidden = false;
    },
    unhideTextInstance: (text) => {
      operations.unhideTextInstance += 1;
      text.hidden = false;
    },
    waitForCommitToBeReady: () => null,
  };
  const reconciler = createReactReconciler(host);

  return {
    createRoot: (container) => {
      const root = reconciler.createContainer(
        container,
        0,
        null,
        false,
        null,
        "",
        reconciler.defaultOnUncaughtError,
        reconciler.defaultOnCaughtError,
        reconciler.defaultOnRecoverableError,
        null,
      );

      return {
        render: (node) => {
          reconciler.updateContainerSync(node, root, null, null);
        },
        unmount: () => {
          reconciler.updateContainerSync(null, root, null, null);
        },
      };
    },
    flushSync: (callback) => {
      reconciler.flushSyncFromReconciler(callback);
      reconciler.flushSyncWork();
    },
    operations,
  };
}

export const clientRuntimes = [
  {
    createContext: createFigContext,
    createElement: createFigElement,
    createRenderer: createFigBenchRenderer,
    id: "fig",
    label: "Fig",
    providerFor: (context) => context,
    readContext: readFigContext,
    readPromise: readFigPromise,
    Suspense: FigSuspense,
    transition: figTransition,
    useSyncExternalStore: useFigSyncExternalStore,
    useState: useFigState,
    ViewTransition: FigViewTransition,
  },
  {
    createContext: createReactContext,
    createElement: createReactElement,
    createRenderer: createReactBenchRenderer,
    id: "react",
    label: "React",
    providerFor: (context) => context.Provider,
    readContext: useReactContext,
    readPromise: useReactPromise,
    Suspense: ReactSuspense,
    useSyncExternalStore: useReactSyncExternalStore,
    useState: useReactState,
  },
];

export const figOnlyRuntime = {
  id: "fig",
  label: "Fig",
};

export const hydrationRuntimes = [
  {
    id: "scan",
    label: "Scan",
  },
  {
    id: "map",
    label: "Map",
  },
];
