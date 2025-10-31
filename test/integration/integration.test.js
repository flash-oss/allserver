const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

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
    forcedTimeout() {
        return new Promise((resolve) => setTimeout(resolve, 10)); // resolve in 10ms, which is longer than the timeout of 1ms
    },
};

async function callClientMethods(client) {
    let response;

    // twice in a row
    response = await client.sayHello({ name: "world" });
    const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
    assert.deepEqual(response, expectedHello);
    response = await client.sayHello({ name: "world" });
    assert.deepEqual(response, expectedHello);

    // Introspection work
    response = await client.introspect({});
    assert.deepEqual(Object.keys(procedures), Object.keys(JSON.parse(response.procedures)));
    // Turn off introspection
    response = await client.introspection({ enable: false });
    assert.equal(response.success, true);
    // Introspection should not work now
    response = await client.introspect();
    assert.equal(response.success, false);
    assert.equal(response.code, "ALLSERVER_CLIENT_INTROSPECTION_FAILED");
    // Turn on introspection
    response = await client.introspection({ enable: true });
    assert.equal(response.success, true);
    // Introspection should be back working
    response = await client.introspect();
    assert.equal(response.success, true);
    assert.equal(response.code, "ALLSERVER_INTROSPECTION");

    for (const number of [0, 1, 2, 3]) {
        response = await client.gate({ number });
        assert.equal(response.success, number <= 2);
    }

    response = await client.throws({});
    assert.equal(response.success, false);
    assert.equal(response.code, "ALLSERVER_PROCEDURE_ERROR");
    assert(response.message.startsWith("'Cannot read "));
    assert(response.message.endsWith(" error in 'throws' procedure"));

    response = await client.throwsBadArgs({});
    assert.equal(response.success, false);
    assert.equal(response.code, "ERR_ASSERTION");
    assert.equal(response.message, `'missingArg is mandatory' error in 'throwsBadArgs' procedure`);

    response = await client.unexist({});
    assert.equal(response.success, false);
    assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND");
    assert.equal(response.message, "Procedure 'unexist' not found via introspection");

    client[Symbol.for("AllserverClient")].timeout = 1;
    response = await client.forcedTimeout({});
    assert.equal(response.success, false);
    assert.equal(response.code, "ALLSERVER_CLIENT_TIMEOUT");
    assert.equal(response.message, "The remote procedure forcedTimeout timed out in 1 ms");
    client[Symbol.for("AllserverClient")].timeout = 0;
}

let {
    Allserver,
    HttpTransport,
    ExpressTransport,
    GrpcTransport,
    LambdaTransport,
    BullmqTransport,
    BullmqClientTransport,
    MemoryTransport,
    AllserverClient,
    GrpcClientTransport,
    LambdaClientTransport,
} = require("../..");
Allserver = Allserver.props({ logger: { error() {} } }); // silence the servers console because we test error cases here

describe("integration", function () {
    describe("http", () => {
        const fetch = globalThis.fetch;

        it("should behave with AllserverClient", async () => {
            const httpClient = AllserverClient({ uri: "http://localhost:40000" });

            let response;
            response = await httpClient.sayHello({ name: "world" });
            assert.equal(response.success, false);
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.equal(response.message, "Couldn't reach remote procedure: sayHello");
            if (response.error.cause) assert.equal(response.error.cause.code, "ECONNREFUSED");
            else assert(response.error.message.includes("ECONNREFUSED"));

            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 40000 }) });
            await httpServer.start();

            await callClientMethods(httpClient);

            // HTTP-ony specific tests

            // Should return 400
            response = await httpClient.throwsBadArgs();
            assert.equal(response.code, "ERR_ASSERTION");
            assert.equal(response.error.status, 400);

            // Should return 404
            response = await httpClient.unexist();
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND");

            // Should return 500
            response = await httpClient.throws();
            assert.equal(response.code, "ALLSERVER_PROCEDURE_ERROR");
            assert.equal(response.error.status, 500);

            await httpServer.stop();
        });

        it("should behave with fetch", async () => {
            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 40001 }) });
            await httpServer.start();

            let response;

            response = await (
                await fetch("http://localhost:40001/sayHello", {
                    method: "POST",
                    body: JSON.stringify({ name: "world" }),
                })
            ).json();
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepEqual(response, expectedHello);

            // HTTP-ony specific tests

            // Should return 400
            response = await fetch("http://localhost:40001/sayHello", {
                method: "POST",
                body: Buffer.allocUnsafe(999),
            });
            assert(!response.ok);
            assert.equal(response.status, 400);

            // Should call using GET with query params
            response = await fetch("http://localhost:40001/sayHello?name=world");
            assert(response.ok);
            const body = await response.json();
            assert.deepEqual(body, expectedHello);

            const httpClient = AllserverClient({ uri: "http://localhost:40001" });
            await callClientMethods(httpClient);
            await httpServer.stop();
        });
    });

    describe("express", () => {
        const express = require("express");
        const fetch = globalThis.fetch;

        it("should behave with AllserverClient", async () => {
            const httpClient = AllserverClient({ uri: "http://localhost:40002/express/allserver" });

            let response;
            response = await httpClient.sayHello({ name: "world" });
            assert.equal(response.success, false);
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.equal(response.message, "Couldn't reach remote procedure: sayHello");
            if (response.error.cause) assert.equal(response.error.cause.code, "ECONNREFUSED");
            else assert(response.error.message.includes("ECONNREFUSED"));

            const app = express();
            const expressServer = Allserver({ procedures, transport: ExpressTransport() });
            app.use("/express/allserver", expressServer.start());
            let server;
            await new Promise((r, e) => (server = app.listen(40002, (err) => (err ? e(err) : r()))));

            await callClientMethods(httpClient);

            // HTTP-ony specific tests

            // Should return 400
            response = await httpClient.throwsBadArgs();
            assert.equal(response.code, "ERR_ASSERTION");
            assert.equal(response.error.status, 400);

            // Should return 404
            response = await httpClient.unexist();
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_NOT_FOUND");

            // Should return 500
            response = await httpClient.throws();
            assert.equal(response.code, "ALLSERVER_PROCEDURE_ERROR");
            assert.equal(response.error.status, 500);

            if (server.closeIdleConnections) server.closeIdleConnections();
            await server.close();
        });

        it("should behave with fetch", async () => {
            const app = express();
            const expressServer = Allserver({ procedures, transport: ExpressTransport() });
            app.use("/express/allsever", expressServer.start());
            let server;
            await new Promise((r, e) => (server = app.listen(40003, (err) => (err ? e(err) : r()))));

            let response;

            response = await (
                await fetch("http://localhost:40003/express/allsever/sayHello", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "world" }),
                })
            ).json();
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepEqual(response, expectedHello);

            // HTTP-ony specific tests

            // Should return 400
            response = await fetch("http://localhost:40003/express/allsever/sayHello", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: Buffer.allocUnsafe(999),
            });
            assert(!response.ok);
            assert.equal(response.status, 400);

            // Should call using GET with query params
            response = await fetch("http://localhost:40003/express/allsever/sayHello?name=world");
            assert(response.ok);
            const body = await response.json();
            assert.deepEqual(body, expectedHello);

            const httpClient = AllserverClient({ uri: "http://localhost:40003/express/allsever" });
            await callClientMethods(httpClient);

            if (server.closeIdleConnections) server.closeIdleConnections();
            await server.close();
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
            assert.equal(response.success, false);
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.equal(response.message, "Couldn't reach remote procedure: sayHello");

            // Without protoFile
            grpcClient = AllserverClient({
                transport: GrpcClientTransport({ uri: "grpc://localhost:50051" }),
            });

            response = await grpcClient.sayHello({ name: "world" });
            assert.equal(response.success, false);
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.equal(response.message, "Couldn't reach remote procedure: sayHello");

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
            const { promisify } = require("node:util");
            for (const k in client) if (typeof client[k] === "function") client[k] = promisify(client[k].bind(client));

            const response = await client.sayHello({ name: "world" });
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepEqual(response, expectedHello);

            await grpcServer.stop();
        });
    });

    describe("lambda", () => {
        const LocalLambdaClientTransport = require("./LocalLambdaClientTransport");

        it("should behave using mocked client", async () => {
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

        it("should behave using mocked server", async () => {
            const lambdaServer = Allserver({
                procedures,
                transport: LambdaTransport(),
            });
            const lambdaHandler = lambdaServer.start();

            const localLambda = require("lambda-local");
            localLambda.setLogger({ log() {}, transports: [] }); // silence logs

            // Mocking the AWS SDK
            const MockedLambdaClientTransport = LambdaClientTransport.props({
                awsSdkLambdaClient: {
                    async invoke({ /*FunctionName,*/ Payload }) {
                        const response = await localLambda.execute({
                            event: Payload && JSON.parse(Payload),
                            lambdaFunc: { handler: lambdaHandler },
                        });
                        return { Payload: JSON.stringify(response) };
                    },
                },
            });

            const lambdaClient = AllserverClient({
                transport: MockedLambdaClientTransport({ uri: "my-lambda-name" }),
            });

            await callClientMethods(lambdaClient);
        });
    });

    describe("memory", () => {
        it("should behave with AllserverClient", async () => {
            const memoryServer = Allserver({
                procedures,
                transport: MemoryTransport(),
            });

            const memoryClient = memoryServer.start();

            await callClientMethods(memoryClient);
        });
    });

    describe("bullmq", () => {
        it("should behave with AllserverClient", async () => {
            let bullmqClient = AllserverClient({ uri: `bullmq://localhost:65432` }); // This port should not have Redis server on it.

            const response = await bullmqClient.sayHello({ name: "world" });
            assert.equal(response.success, false);
            assert.equal(response.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.equal(response.message, "Couldn't reach remote procedure: sayHello");
            assert.equal(response.error.code, "ECONNREFUSED");

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
            assert.deepEqual(response, expectedHello);

            await bullmqServer.stop();
        });
    });
    {
        timeout: 5000;
    }
});
