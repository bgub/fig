import { Schema } from "effect";

export class StartConfigError extends Schema.TaggedErrorClass<StartConfigError>()(
  "StartConfigError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class StartListenError extends Schema.TaggedErrorClass<StartListenError>()(
  "StartListenError",
  {
    cause: Schema.Defect(),
    port: Schema.Number,
  },
) {}
