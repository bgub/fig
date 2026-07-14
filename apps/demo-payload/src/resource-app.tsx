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
    <article class="frame frame-payload" data-resource-seed={seed}>
      <span class="tag">payload shell</span>
      <h2>Post #{seed}</h2>
      <p class="muted" data-resource-audit>
        {audit.source} · request {audit.requestId} · rendered on the server
      </p>
      <div>
        <LikeButtonRef label={`post-${seed}`} />
      </div>
      <Suspense fallback={<CommentsPending />}>
        <Comments comments={comments} seed={seed} />
      </Suspense>
    </article>
  );
}

// The streamed hole while its row is still on the wire: same frame, dashed.
function CommentsPending() {
  return (
    <div
      class="frame frame-streamed slot-pending"
      data-resource-comments="pending"
    >
      <span class="tag">streamed hole</span>
      <p class="slot-note">comments streaming…</p>
      <div class="skeleton">
        <i />
        <i />
      </div>
    </div>
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
    <div class="frame frame-streamed" data-resource-comments="ready">
      <span class="tag">streamed hole</span>
      <ul class="comments">
        {items.map((comment) => (
          <li key={comment}>
            {comment} (post {seed})
          </li>
        ))}
      </ul>
    </div>
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
