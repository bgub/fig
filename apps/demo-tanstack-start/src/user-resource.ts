import { dataResource } from "@bgub/fig";
import { getUser } from "./user-functions.ts";
import type { UserSnapshot } from "./users.ts";

export const userResource = dataResource<[string], UserSnapshot>({
  key: (id) => ["start-demo-user", id],
  load: (id, { signal }) => getUser({ data: { id }, signal }),
});
