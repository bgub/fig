import { readData, readPromise, Suspense } from "@bgub/fig";
import { payloadAuditResource } from "./data.server.ts";
import { payloadSummaryResource } from "./data.ts";
import {
  LikeButtonRef,
  PostSlotRef,
  WeatherSlotRef,
} from "./resource-shared.ts";

// The resource-model server tree (docs/concepts/data.md): no
// PayloadBoundary, no refresh protocol — one renderToPayloadStream call
// serves the whole value, and the client refreshes it as an ordinary data
// resource. The comments promise is created by the route handler and passed
// as a prop so its identity is stable across serialization retries.
interface ResourcePostProps {
  comments: Promise<string[]>;
  seed: number;
}

export function ResourcePost({ comments, seed }: ResourcePostProps) {
  const audit = readData(payloadAuditResource, seed);
  // Also streams as a data row, so the client store hydrates this entry
  // from the same response.
  const summary = readData(payloadSummaryResource, seed);

  return (
    <article class="frame frame-payload" data-resource-seed={seed}>
      <span class="tag">payload shell</span>
      <h2>Post #{seed}</h2>
      <p class="muted" data-resource-audit>
        {audit.views.toLocaleString()} views — read on the server, loader never
        shipped to the browser
      </p>
      <p class="muted" data-resource-summary>
        {summary.likes} likes — streamed as a data row and hydrated into the
        client store (server render #{summary.renders})
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

// The outermost payload slot: a server component surrounding the other
// serialized slots. It streams only its own frame — the post and weather
// inside are client references whose components keep reading their own
// resources — so refreshing the dashboard re-renders the wrapper on the
// server while the inner entries stay untouched.
export function Dashboard({ render }: { render: number }) {
  return (
    <section class="frame frame-payload" data-dashboard-render={render}>
      <span class="tag">payload shell</span>
      <h2>Dashboard</h2>
      <p class="muted" data-dashboard-note>
        A server component wrapping the slots below (server render #{render}).
        Refreshing it re-streams this frame; the slots keep their own resource
        entries.
      </p>
      <div class="dashboard-grid">
        <PostSlotRef />
        <WeatherSlotRef />
      </div>
    </section>
  );
}

// The second payload slot: an independent resource with its own key, so the
// demo can refresh one slot without touching the other. The reading is
// random per server render, and the counter makes each refresh deterministic
// to assert on.
export interface WeatherReading {
  condition: string;
  reading: number;
  temperatureC: number;
}

export function WeatherReport({ weather }: { weather: WeatherReading }) {
  return (
    <article class="frame frame-payload" data-weather-reading={weather.reading}>
      <span class="tag">payload shell</span>
      <h2>Current weather</h2>
      <p class="muted" data-weather-report>
        {weather.temperatureC}°C and {weather.condition} — regenerated on every
        server render (reading #{weather.reading})
      </p>
    </article>
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
