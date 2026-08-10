import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ useSession: vi.fn() }));
vi.mock("axios", () => ({ default: { get: vi.fn() } }));

import axios from "axios";
import { permissionStore, type Me } from "@/lib/use-permissions";

const mockedGet = vi.mocked(axios.get);

function me(id: string, permissions: string[]): Me {
  return { id, name: id, role: "role", schoolName: "school", permissions };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  permissionStore.clear();
  mockedGet.mockReset();
});

describe("permissionStore", () => {
  it("shares one concurrent /api/me request", async () => {
    const request = deferred<{ data: Me }>();
    mockedGet.mockReturnValueOnce(request.promise);

    const first = permissionStore.syncSession("school:user:role");
    const second = permissionStore.syncSession("school:user:role");

    expect(mockedGet).toHaveBeenCalledTimes(1);
    request.resolve({ data: me("user", ["students.view"]) });
    await Promise.all([first, second]);
    expect(permissionStore.getSnapshot().status).toBe("ready");
  });

  it("notifies subscribers immediately on invalidation and publishes refreshed permissions", async () => {
    mockedGet.mockResolvedValueOnce({ data: me("user", ["students.view"]) });
    await permissionStore.syncSession("school:user:role");

    const states: string[] = [];
    const unsubscribe = permissionStore.subscribe(() => {
      const current = permissionStore.getSnapshot();
      states.push(`${current.status}:${current.me?.permissions.join(",") ?? "none"}`);
    });
    const refresh = deferred<{ data: Me }>();
    mockedGet.mockReturnValueOnce(refresh.promise);

    const invalidation = permissionStore.invalidate();
    expect(states.at(-1)).toBe("loading:none");
    refresh.resolve({ data: me("user", ["students.manage"]) });
    await invalidation;

    expect(states.at(-1)).toBe("ready:students.manage");
    unsubscribe();
  });

  it("does not retain or republish the previous user's permissions", async () => {
    const oldRequest = deferred<{ data: Me }>();
    mockedGet.mockReturnValueOnce(oldRequest.promise);
    const oldLoad = permissionStore.syncSession("school:old:role");

    mockedGet.mockResolvedValueOnce({ data: me("new", ["staff.view"]) });
    await permissionStore.syncSession("school:new:role");
    expect(permissionStore.getSnapshot().me?.id).toBe("new");

    oldRequest.resolve({ data: me("old", ["*"]) });
    await oldLoad;
    expect(permissionStore.getSnapshot().me?.id).toBe("new");

    permissionStore.clear();
    expect(permissionStore.getSnapshot()).toMatchObject({
      sessionKey: null,
      status: "idle",
      me: null,
    });
  });

  it("reports fetch failure as an explicit safe error state", async () => {
    mockedGet.mockRejectedValueOnce(new Error("network"));
    await permissionStore.syncSession("school:user:role");
    expect(permissionStore.getSnapshot()).toMatchObject({ status: "error", me: null });
    expect(permissionStore.getSnapshot().error).toBeInstanceOf(Error);
  });
});
