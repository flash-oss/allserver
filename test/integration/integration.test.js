const assert = require("assert");

const procedures = {
    sayHello({ name }) {
        // await new Promise((r) => setTimeout(r, 61000));
        return "Hello " + name;
    },
    introspection({ enable }, { allserver }) {
        allserver.introspection = Boolean(enable);
    },
    async gate({ number }) {
        if (number === 0) return undefined;
        if (number === 1) return { length: 42 };
        if (number === 2) return { name: "Golden Gate", lastVehicle: "0 seconds ago" };
        return { success: false, code: "GATE_NOT_FOUND", message: `Gate ${number} was not found` };
    },
    getArg(arg) {
        return arg;
    },
    throws() {
        this.ping.me();
    },
    throwsBadArgs(arg) {
        assert(arg.missingArg, "missingArg is mandatory");
    },
    createUser({ firstName, lastName }) {
        // call database ...
        return { success: true, code: "CREATED", user: { id: String(Math.random()).substr(2), firstName, lastName } };
    },
};

async function callClientMethods(client) {
    let response;

    // twice in a row
    response = await client.sayHello({ name: "world" });
    const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
    assert.deepStrictEqual(response, expectedHello);
    response = await client.sayHello({ name: "world" });
    assert.deepStrictEqual(response, expectedHello);

    // Introspection work
    response = await client.introspect({});
    assert.deepStrictEqual(Object.keys(procedures), Object.keys(JSON.parse(response.procedures)));
    // Turn off introspection
    response = await client.introspection({ enable: false });
    assert.strictEqual(response.success, true);
    // Introspection should not work now
    response = await client.introspect();
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.code, "ALLSERVER_CLIENT_INTROSPECTION_FAILED");
    // Turn on introspection
    response = await client.introspection({ enable: true });
    assert.strictEqual(response.success, true);
    // Introspection should be back working
    response = await client.introspect();
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.code, "ALLSERVER_INTROSPECTION");

    for (const number of [0, 1, 2, 3]) {
        response = await client.gate({ number });
        assert.strictEqual(response.success, number <= 2);
    }

    response = await client.throws({});
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.code, "ALLSERVER_PROCEDURE_ERROR");
    assert(response.message.startsWith("'Cannot read "));
    assert(response.message.endsWith(" error in 'throws' procedure"));

    response = await client.throwsBadArgs({});
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.code, "ERR_ASSERTION");
    assert.strictEqual(response.message, `'missingArg is mandatory' error in 'throwsBadArgs' procedure`);

    response = await client.unexist({});
    assert.strictEqual(response.success, false);
    assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND");
    assert.strictEqual(response.message, "Procedure 'unexist' not found via introspection");
}

let {
    Allserver,
    HttpTransport,
    ExpressTransport,
    GrpcTransport,
    LambdaTransport,
    BullmqTransport,
    BullmqClientTransport,
    AllserverClient,
    GrpcClientTransport,
} = require("../..");
Allserver = Allserver.props({ logger: { error() {} } }); // silence the servers

describe("integration", function () {
    this.timeout(5000); // Needed for CI on Windows.

    describe("http", () => {
        const fetch = require("node-fetch");

        it("should behave with AllserverClient", async () => {
            const httpClient = AllserverClient({ uri: "http://localhost:40000" });

            let response;
            response = await httpClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");
            assert(response.error.message.includes("ECONNREFUSED"));

            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 40000 }) });
            await httpServer.start();

            await callClientMethods(httpClient);

            // HTTP-ony specific tests

            // Should return 400
            response = await httpClient.throwsBadArgs();
            assert.strictEqual(response.code, "ERR_ASSERTION");
            assert.strictEqual(response.error.status, 400);

            // Should return 404
            response = await httpClient.unexist();
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND");

            // Should return 500
            response = await httpClient.throws();
            assert.strictEqual(response.code, "ALLSERVER_PROCEDURE_ERROR");
            assert.strictEqual(response.error.status, 500);

            await httpServer.stop();
        });

        it("should behave with node-fetch", async () => {
            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 40000 }) });
            await httpServer.start();

            let response;

            response = await (
                await fetch("http://localhost:40000/sayHello", {
                    method: "POST",
                    body: JSON.stringify({ name: "world" }),
                })
            ).json();
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepStrictEqual(response, expectedHello);

            // HTTP-ony specific tests

            // Should return 400
            response = await fetch("http://localhost:40000/sayHello", {
                method: "POST",
                body: Buffer.allocUnsafe(999),
            });
            assert(!response.ok);
            assert.strictEqual(response.status, 400);

            // Should call using GET with query params
            response = await fetch("http://localhost:40000/sayHello?name=world");
            assert(response.ok);
            const body = await response.json();
            assert.deepStrictEqual(body, expectedHello);

            const httpClient = AllserverClient({ uri: "http://localhost:40000" });
            await callClientMethods(httpClient);
            await httpServer.stop();
        });
    });

    describe("express", () => {
        const express = require("express");
        const fetch = require("node-fetch");

        it("should behave with AllserverClient", async () => {
            const httpClient = AllserverClient({ uri: "http://localhost:40001/express/allserver" });

            let response;
            response = await httpClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");
            assert(response.error.message.includes("ECONNREFUSED"));

            const app = express();
            const expressServer = Allserver({ procedures, transport: ExpressTransport() });
            app.use("/express/allserver", expressServer.start());
            let server;
            await new Promise((r, e) => (server = app.listen(40001, (err) => (err ? e(err) : r()))));

            await callClientMethods(httpClient);

            // HTTP-ony specific tests

            // Should return 400
            response = await httpClient.throwsBadArgs();
            assert.strictEqual(response.code, "ERR_ASSERTION");
            assert.strictEqual(response.error.status, 400);

            // Should return 404
            response = await httpClient.unexist();
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND");

            // Should return 500
            response = await httpClient.throws();
            assert.strictEqual(response.code, "ALLSERVER_PROCEDURE_ERROR");
            assert.strictEqual(response.error.status, 500);

            await new Promise((r) => server.close(r));
        });

        it("should behave with node-fetch", async () => {
            const app = express();
            const expressServer = Allserver({ procedures, transport: ExpressTransport() });
            app.use("/express/allsever", expressServer.start());
            let server;
            await new Promise((r, e) => (server = app.listen(40001, (err) => (err ? e(err) : r()))));

            let response;

            response = await (
                await fetch("http://localhost:40001/express/allsever/sayHello", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "world" }),
                })
            ).json();
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepStrictEqual(response, expectedHello);

            // HTTP-ony specific tests

            // Should return 400
            response = await fetch("http://localhost:40001/express/allsever/sayHello", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: Buffer.allocUnsafe(999),
            });
            assert(!response.ok);
            assert.strictEqual(response.status, 400);

            // Should call using GET with query params
            response = await fetch("http://localhost:40001/express/allsever/sayHello?name=world");
            assert(response.ok);
            const body = await response.json();
            assert.deepStrictEqual(body, expectedHello);

            const httpClient = AllserverClient({ uri: "http://localhost:40001/express/allsever" });
            await callClientMethods(httpClient);

            await new Promise((r) => server.close(r));
        });
    });

    describe("grpc", () => {
        const protoFile = __dirname + "/allserver_integration_test.proto";

        it("should behave with AllserverClient", async () => {
            let response, grpcClient;

            // With protoFile
            grpcClient = AllserverClient({
                transport: GrpcClientTransport({ protoFile, uri: "grpc://localhost:50051" }),
            });
            response = await grpcClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");

            // Without protoFile
            grpcClient = AllserverClient({
                transport: GrpcClientTransport({ uri: "grpc://localhost:50051" }),
            });

            response = await grpcClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");

            const grpcServer = Allserver({
                procedures,
                transport: GrpcTransport({
                    protoFile,
                    port: 50051,
                    options: {},
                }),
            });
            await grpcServer.start();

            await callClientMethods(grpcClient);

            await grpcServer.stop();
        });

        it("should behave with @grpc/grpc-js", async () => {
            const grpcServer = Allserver({
                procedures,
                transport: GrpcTransport({ protoFile, port: 50051 }),
            });
            await grpcServer.start();

            const grpc = require("@grpc/grpc-js");
            const packageDefinition = require("@grpc/proto-loader").loadSync(
                __dirname + "/allserver_integration_test.proto"
            );
            const proto = grpc.loadPackageDefinition(packageDefinition);
            const client = new proto.MyService("localhost:50051", grpc.credentials.createInsecure());
            const { promisify } = require("util");
            for (const k in client) if (typeof client[k] === "function") client[k] = promisify(client[k].bind(client));

            const response = await client.sayHello({ name: "world" });
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepStrictEqual(response, expectedHello);

            await grpcServer.stop();
        });
    });

    describe("lambda", () => {
        const LocalLambdaClientTransport = require("./LocalLambdaClientTransport");

        it("should behave with AllserverClient", async () => {
            const lambdaServer = Allserver({
                procedures,
                transport: LambdaTransport(),
            });

            const lambdaClient = AllserverClient({
                transport: LocalLambdaClientTransport({
                    uri: "http://local/prefix",
                    lambdaHandler: lambdaServer.start(),
                }),
            });

            await callClientMethods(lambdaClient);
        });
    });

    describe("bullmq", () => {
        it("should behave with AllserverClient", async () => {
            let bullmqClient = AllserverClient({ uri: `bullmq://localhost:65432` }); // This port should not have Redis server on it.

            const response = await bullmqClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");
            assert(response.error.message.includes("ECONNREFUSED"));

            if (process.platform === "win32") return;

            const port = 6379;
            const bullmqServer = Allserver({
                procedures,
                transport: BullmqTransport({ connectionOptions: { host: "localhost", port } }),
            });
            await bullmqServer.start();

            bullmqClient = AllserverClient({ uri: `bullmq://localhost:${port}` });
            await callClientMethods(bullmqClient);
            bullmqClient = AllserverClient({ transport: BullmqClientTransport({ uri: `redis://localhost:${port}` }) });
            await callClientMethods(bullmqClient);

            await bullmqServer.stop();
        });

        it("should behave with 'bullmq' module", async () => {
            if (process.platform === "win32") return;

            const port = 6379;
            const bullmqServer = Allserver({
                procedures,
                transport: BullmqTransport({ queueName: "OtherName", connectionOptions: { host: "localhost", port } }),
            });
            await bullmqServer.start();

            const { Queue, QueueEvents } = require("bullmq");

            const queue = new Queue("OtherName", { connection: { host: "localhost", port } });
            queue.on("error", () => {}); // This line removes noisy console.error() output which is emitted while Redis is starting
            const queueEvents = new QueueEvents("OtherName", { connection: { host: "localhost", port } });
            queueEvents.on("error", () => {}); // This line removes noisy console.error() output which is emitted while Redis is starting
            const jobsOptions = { removeOnComplete: true, removeOnFail: true };
            const job = await queue.add("sayHello", { name: "world" }, jobsOptions);
            const response = await job.waitUntilFinished(queueEvents, 1000);
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepStrictEqual(response, expectedHello);

            await bullmqServer.stop();
        });
    });
});
