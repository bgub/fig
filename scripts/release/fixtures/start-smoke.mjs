import assert from "node:assert/strict";
import { Window } from "happy-dom";

const { default: server } = await import("./start/dist/server/server.js");
const response = await server.fetch(new Request("http://localhost/"));
assert.equal(response.status, 200);
const window = new Window();
window.document.body.innerHTML = await response.text();
assert.equal(window.document.querySelector("button")?.textContent, "Count: 0");
await window.happyDOM.close();
console.log("Packed Start client/server builds and server rendering passed.");
