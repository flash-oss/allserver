const assert = require("assert");

const procedures = {
    sayHello({ name }) {
        return "Hello " + name;
    },
    introspection({ enable }, { allserver }) {
        allserver.introspection = Boolean(enable);
    },
    gate({ number }) {
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
    assert.strictEqual(response.code, "INTROSPECTION_FAILED");
    // Turn on introspection
    response = await client.introspection({ enable: true });
    assert.strictEqual(response.success, true);
    // Introspection should be back working
    response = await client.introspect();
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.code, "OK");

    for (const number of [0, 1, 2, 3]) {
        response = await client.gate({ number });
        assert.strictEqual(response.success, number <= 2);
    }

    response = await client.throws({});
    assert.deepStrictEqual(response, {
        success: false,
        code: "ALLSERVER_PROCEDURE_ERROR",
        message: "`Cannot read property 'me' of undefined` in: throws",
    });
}

let { Allserver, HttpTransport, GrpcTransport, AllserverClient, GrpcClientTransport } = require("..");
Allserver = Allserver.props({ logger: { error() {} } }); // silence the servers

describe("integration", () => {
    describe("http", () => {
        const fetch = require("node-fetch");

        it("should behave with AllserverClient", async () => {
            const httpClient = AllserverClient({ uri: "http://localhost:54000" });

            let response;
            response = await httpClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");
            assert(response.error.message.includes("ECONNREFUSED"));

            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 54000 }) });
            httpServer.start();

            await callClientMethods(httpClient);

            // HTTP-ony specific tests

            // Should return 404
            response = await httpClient.unexist();
            assert.strictEqual(response.code, "ALLSERVER_PROCEDURE_NOT_FOUND");
            assert.strictEqual(response.error.status, 404);

            await httpServer.stop();
        });

        it("should behave with node-fetch", async () => {
            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 54000 }) });
            httpServer.start();

            let response;

            response = await (
                await fetch("http://localhost:54000/sayHello", {
                    method: "POST",
                    body: JSON.stringify({ name: "world" }),
                })
            ).json();
            const expectedHello = { success: true, code: "SUCCESS", message: "Success", sayHello: "Hello world" };
            assert.deepStrictEqual(response, expectedHello);

            // HTTP-ony specific tests

            // Should return 400
            response = await fetch("http://localhost:54000/sayHello", {
                method: "POST",
                body: Buffer.allocUnsafe(999),
            });
            assert(!response.ok);
            assert.strictEqual(response.status, 400);

            // Should call using GET with query params
            response = await fetch("http://localhost:54000/sayHello?name=world");
            assert(response.ok);
            const body = await response.json();
            assert.deepStrictEqual(body, expectedHello);

            const httpClient = AllserverClient({ uri: "http://localhost:54000" });
            await callClientMethods(httpClient);
            await httpServer.stop();
        });
    });

    describe("grpc", () => {
        const protoFile = __dirname + "/allserver_integration_test.proto";

        it("should behave with AllserverClient", async () => {
            let response, grpcClient;

            // With protoFile
            grpcClient = AllserverClient({
                transport: GrpcClientTransport({ protoFile, uri: "grpc://localhost:50051", connectionDelaySec: 0.1 }),
            });
            response = await grpcClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "ALLSERVER_PROCEDURE_UNREACHABLE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");

            // Without protoFile
            grpcClient = AllserverClient({
                transport: GrpcClientTransport({ uri: "grpc://localhost:50051", connectionDelaySec: 0.1 }),
            });

            response = await grpcClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "GRPC_PROTO_MISSING");
            assert.strictEqual(response.message, "gRPC client was not yet initialised");

            // Warning! Protected variable change:
            grpcClient[Symbol.for("AllserverClient")].transport._connectionDelaySec = 10;

            const grpcServer = Allserver({
                procedures,
                transport: GrpcTransport({
                    protoFile,
                    port: 50051,
                    options: {},
                }),
            });
            await grpcServer.start();
            await new Promise((r) => setTimeout(r, 1000)); // FFS HTTP2.

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
});
