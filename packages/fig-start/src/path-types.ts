// Type-level parsing of a route path literal into its params object type, so
// `Route.useParams()` is typed straight from `createFileRoute("/posts/$postId")`
// with no codegen. Pathless segments ("_authed") and static segments contribute
// nothing; `$name` becomes a string param; a trailing `$` is the splat param.

export type ParsePathParams<TPath extends string> =
  TPath extends `${infer Head}/${infer Tail}`
    ? SegmentParam<Head> & ParsePathParams<Tail>
    : SegmentParam<TPath>;

type SegmentParam<TSegment extends string> = TSegment extends "$"
  ? { _splat: string }
  : TSegment extends `$${infer Name}`
    ? { [K in Name]: string }
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

// Collapse an intersection of single-key objects into one clean object type.
export type RouteParams<TPath extends string> = Prettify<
  ParsePathParams<TPath>
>;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};
