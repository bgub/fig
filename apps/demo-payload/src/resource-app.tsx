import { readData, readPromise, Suspense } from "@bgub/fig";
import { payloadAuditResource } from "./data.server.ts";
import { payloadSummaryResource } from "./data.ts";
import { LikeButtonRef } from "./resource-shared.ts";

// The resource-model server tree (docs/plans/serialized-components.md): no
// PayloadBoundary, no refresh protocol — one renderToPayloadStream call
// serves the whole value, and the client refreshes it as an ordinary data
// resource. The comments promise is created by the route handler and passed
// as a prop so its identity is stable across serialization retries.
export interface ResourcePostProps {
  comments: Promise<string[]>;
  seed: number;
}

export function ResourcePost({ comments, seed }: ResourcePostProps) {
  const audit = readData(payloadAuditResource, seed);
  // Read but unused directly: streams as a data row so the client's
  // isomorphic summary entry freshens from the same response.
  readData(payloadSummaryResource, seed);

  return (
    <article class="panel resource-post" data-resource-seed={seed}>
      <div class="panel-header">
        <div>
          <h2>Serialized post #{seed}</h2>
          <p class="muted" data-resource-audit>
            {audit.source} · request {audit.requestId}
          </p>
        </div>
        <span class="tag ok">resource</span>
      </div>
      <div class="panel-actions">
        <LikeButtonRef label={`post-${seed}`} />
      </div>
      <Suspense
        fallback={<p data-resource-comments="pending">Loading comments…</p>}
      >
        <Comments comments={comments} seed={seed} />
      </Suspense>
    </article>
  );
}

function Comments({
  comments,
  seed,
}: {
  comments: Promise<string[]>;
  seed: number;
}) {
  const items = readPromise(comments);
  return (
    <ul data-resource-comments="ready">
      {items.map((comment) => (
        <li key={comment}>
          {comment} (post {seed})
        </li>
      ))}
    </ul>
  );
}

export function resourceComments(seed: number): Promise<string[]> {
  return new Promise((resolve) => {
    setTimeout(
      () => resolve([`First comment ${seed}`, `Second comment ${seed}`]),
      400,
    );
  });
}
