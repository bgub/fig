# Fiber architecture

You may have heard people talk about "React Fiber." Here's a broad overview of what that means and how Fig implements a similar architecture. Pretty much everything here applies to both Fig and React, but I'll use the name Fig for consistency.

At a high level, a Fig update moves through three phases: **trigger**, **render**, and **commit**. We'll talk about render and commit first.

## Render phase

Fig keeps track of a committed fiber generation called `current` and builds a work-in-progress generation through `alternate` links. `current` reflects what's in the DOM.

In the **render phase**, Fig builds the work-in-progress tree by walking depth-first, calling component functions and reconciling what they return. Each unit of work is called a **fiber**. Fibers represent components as well as host nodes (such as DOM elements), text, and boundaries. Clean subtrees can reuse their committed children, while changed fibers receive flags describing the work that commit must perform.

When a component calls a hook like `useState`, we add a `Hook` to that component fiber's linked list which stores:

- `memoizedState` — the state computed for this fiber generation
- `queue.dispatch` — the setter, i.e. `setCount` (this never changes)
- `queue.pending` — a linked list of state updates in dispatch order, each stored as `{ action, lane }`
- `baseState` + `baseQueue` — the rebase ledger

Accessing a hook's value is purely order based (the reason you can't call hooks conditionally).

We also add flags to fibers that give helpful information for the commit step. An example: `DeletionFlag` means that a fiber has children queued for deletion.

You may be wondering what `lane`, `baseState`, and `baseQueue` are. I'll talk about that later in this doc!

## Commit phase

In the **commit phase**, Fig synchronously applies those changes to the DOM and sets `root.current` to the finished work. The previous generation remains linked through `alternate` and can be reused by the next render. It uses flags set in the render phase to intelligently skip subtrees.

## Scheduling

Fiber introduces one key capability: interruptible rendering. Fig can pause a render and resume it later, or abandon it if more important work arrives.

This solves two problems, both rooted in the **event loop**. JavaScript runs one **macrotask** at a time: a normal chunk of work such as a click handler, a timer, or a Fig scheduler callback. When that finishes, JavaScript runs every queued **microtask**: small follow-up jobs such as promise callbacks and `queueMicrotask` callbacks. Only after both are done can the browser paint, process input, or start the next macrotask. Fig posts its scheduler macrotasks with `MessageChannel` in browsers and `setImmediate` in Node.

- **Motivation 1:** The browser can't paint and process input while a task is running! So an expensive render would cause keyboard input, button interaction, etc. to feel super laggy when those should be instant.
- **Motivation 2:** Some updates are more valuable than others. If we have a high-priority update, we want to discard work on a lower priority update and replay it later so the most important parts of an application remain snappy.

Fiber solves this in the following way:

- Scheduled work gets a 5ms yield budget. We process as many fibers as we can within that budget, then save our position and yield to the browser. Another task resumes where we left off. Sync renders are the exception: once started, they don't time-slice.

## Lanes

Remember how each hook has a queue of `{ action, lane }` objects? In Fig, a lane identifies the scheduling class and priority of an update. `SyncLane` updates (triggered by user input like clicks) have priority over `OffscreenLane` updates (for content that we're preparing but is still hidden). There are 31 lanes in total, and each is represented by a specific bit position.

When you call `setState`, Fig figures out the applicable lane and pushes an update to the hook queue on the relevant fiber. Each fiber has a 32-bit `lanes` property indicating what lanes have queued updates for that fiber. We OR the lane into that property, then walk toward the root and OR it into each ancestor's `childLanes`.

Each render selects a set of lanes led by the highest-priority pending work. Transition and retry lanes may be processed as groups, and related lanes may be entangled. When a fiber's inputs haven't changed and its `lanes` don't intersect the lanes being rendered, Fig doesn't re-render it. If its `childLanes` are also clean, Fig can skip the whole subtree. We update each hook's state by applying the queued updates included in that lane set.

## Interrupts

What happens when you're in the middle of rendering a tree and receive a higher-priority update? Fig discards the current WIP tree and starts working on the higher-priority state update. This ensures things stay fast.

Interruption explains how a higher-priority update can jump ahead, but it creates an ordering problem: a render may skip an earlier, lower-priority update while applying a later one. We keep track of `baseState` and `baseQueue` so the skipped update can be replayed later without changing the order in which the updates were dispatched.

Imagine the following scenario:

```tsx
import { useState, transition } from "@bgub/fig";
import { on } from "@bgub/fig-dom";

function Counter() {
  const [count, setCount] = useState(1);
  return (
    <>
      <button mix={on("click", () => setCount((c) => c * 2))}>double</button>
      <button
        mix={on("click", () => transition(() => setCount((c) => c + 10)))}
      >
        add ten
      </button>
      <ExpensiveChart count={count} />
    </>
  );
}
```

`ExpensiveChart` is slow to render. The user clicks "add ten", and while Fig is rendering that update in the background, they click "double".

Fig cancels the expensive transition render and starts a sync render. It skips the earlier `+10` update, pins `baseState` at `1`, and adds that update to `baseQueue`. Then it applies `c => c * 2`, producing `2`. Because an earlier update was skipped, Fig also adds a priority-cleared clone of `c => c * 2` to `baseQueue` so it will run again during the replay.

Fig commits `2` so the click feels instant. Later, the transition render replays from `baseState`: it applies `c => c + 10` to `1`, producing `11`, then applies the cloned `c => c * 2`, producing `22`. The updates appear at different times, but the final result preserves their original dispatch order.
