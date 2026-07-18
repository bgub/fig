import { createServerFn } from "@bgub/fig-tanstack-start";
import { users, type UserSnapshot } from "./users.ts";

const editCounts = new Map<string, number>();
let loadSequence = 0;

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
  .handler(({ data }) => loadUser(data.id));

export const changeUserRole = createServerFn({ method: "POST" })
  .validator(validateUser)
  .handler(({ data }) => {
    requireUser(data.id);
    editCounts.set(data.id, (editCounts.get(data.id) ?? 0) + 1);
    return { id: data.id };
  });

async function loadUser(id: string): Promise<UserSnapshot> {
  await delay(180);
  const user = requireUser(id);
  loadSequence += 1;
  const editCount = editCounts.get(id) ?? 0;
  return {
    ...user,
    loadedAt: new Date().toLocaleTimeString(),
    loadedBy: "server",
    role:
      editCount === 0 ? user.role : `${user.role} · server edit ${editCount}`,
    sequence: loadSequence,
  };
}

function requireUser(id: string) {
  const user = users[id as keyof typeof users];
  if (user === undefined) throw new Error(`Unknown user “${id}”.`);
  return user;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
