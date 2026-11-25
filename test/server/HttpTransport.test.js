const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { setTimeout } = require("node:timers/promises");

const { Allserver, HttpTransport } = require("../..");

const procedures = {
    async slow({ ms }) {
        await setTimeout(Number(ms));
        return "done";
    },
};

async function startServer() {
    const transport = HttpTransport({ port: 0 });
    const server = Allserver({ procedures, transport, logger: { error() {} } });
    await server.start();
    return { server, url: `http://localhost:${transport.server.address().port}` };
}

describe("HttpTransport", () => {
    describe("#stopServer", () => {
        it("should complete the requests in flight before it closes the connections", async () => {
            const { server, url } = await startServer();
            const response = fetch(`${url}/slow?ms=200`).then((res) => res.json());
            await setTimeout(50);

            await server.stop({ timeoutMs: 1000 });

            assert.equal((await response).slow, "done");
        });

        it("should close the connections of the requests in flight without a timeout", async () => {
            const { server, url } = await startServer();
            const response = fetch(`${url}/slow?ms=200`);
            await setTimeout(50);

            await server.stop();

            await assert.rejects(response);
        });

        it("should close the connections of the requests in flight after the timeout", async () => {
            const { server, url } = await startServer();
            const response = fetch(`${url}/slow?ms=2000`);
            await setTimeout(50);

            const start = Date.now();
            await server.stop({ timeoutMs: 200 });

            assert(Date.now() - start < 1000);
            await assert.rejects(response);
        });
    });
});
