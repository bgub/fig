import { createServerFn } from "@bgub/fig-tanstack-start";
import { users, type UserSnapshot } from "./users.ts";

const editCounts = new Map<string, number>();
const loadCounts = new Map<string, number>();

const validateUser = (input: unknown): { id: string } => {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("A user id is required.");
  }
  const { id } = input as { id?: unknown };
  if (typeof id !== "string") throw new TypeError("A user id is required.");
  return { id };
};

export const getUser = createServerFn({ method: "GET" })
  .validator(validateUser)
  .handler(async ({ context, data }): Promise<UserSnapshot> => {
    await delay(180);
    const user = requireUser(data.id);
    const editCount = editCounts.get(data.id) ?? 0;
    const sequence = (loadCounts.get(data.id) ?? 0) + 1;
    loadCounts.set(data.id, sequence);
    return {
      ...user,
      functionMiddleware: context.functionMiddleware,
      loadedAt: new Date().toLocaleTimeString(),
      loadedBy: "server",
      requestId: context.requestId,
      role:
        editCount === 0 ? user.role : `${user.role} · server edit ${editCount}`,
      sequence,
    };
  });

export const changeUserRole = createServerFn({ method: "POST" })
  .validator(validateUser)
  .handler(({ data }) => {
    requireUser(data.id);
    editCounts.set(data.id, (editCounts.get(data.id) ?? 0) + 1);
    return { id: data.id };
  });

function requireUser(id: string) {
  const user = users[id as keyof typeof users];
  if (user === undefined) throw new Error(`Unknown user “${id}”.`);
  return user;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
