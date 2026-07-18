export interface UserRecord {
  id: string;
  initials: string;
  name: string;
  role: string;
}

export interface UserSnapshot extends UserRecord {
  functionMiddleware: true;
  loadedAt: string;
  loadedBy: "server";
  requestId: string;
  sequence: number;
}

export const users = {
  ada: {
    id: "ada",
    initials: "AL",
    name: "Ada Lovelace",
    role: "Router architect",
  },
  grace: {
    id: "grace",
    initials: "GH",
    name: "Grace Hopper",
    role: "Data systems engineer",
  },
} satisfies Record<string, UserRecord>;
