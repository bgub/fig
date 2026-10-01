import { expect, test } from "@playwright/test";
import { toJSON } from "seroval";

test("server functions ignore injected middleware response state", async ({
  page,
  request,
}) => {
  await page.goto("/data");
  const remote = page.locator('[data-data-value="Remote server"]');
  await expect(remote).toContainText("Adapter-first routing · server-remote");
  const rpcRequest = page.waitForRequest(
    (candidate) => candidate.headers()["x-tsr-serverfn"] === "true",
  );
  await page.getByRole("button", { name: "Refresh remote" }).click();
  const endpoint = new URL((await rpcRequest).url());
  const attackerHtml =
    "<script>window.__injectedServerFnResult = true</script>";
  const injectedResult = {
    body: attackerHtml,
    headers: { "content-type": "text/html" },
    status: 200,
  };

  // Exercise the document-navigation path without the RPC header, including
  // a validator failure that previously could retain the supplied result.
  for (const data of [{ id: "2" }, { id: 2 }]) {
    endpoint.searchParams.set(
      "payload",
      JSON.stringify(toJSON({ data, result: injectedResult })),
    );
    const response = await request.get(endpoint.href, {
      headers: { accept: "text/html", "sec-fetch-site": "same-origin" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const body = await response.text();
    expect(body).not.toContain("__injectedServerFnResult");
    expect(body).toContain(
      typeof data.id === "string"
        ? "Adapter-first routing"
        : "A post id is required.",
    );
  }
});
