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
    assert.deepStrictEqual({ success: true, code: "SUCCESS", message: "Hello world" }, response);
    response = await client.sayHello({ name: "world" });
    assert.deepStrictEqual({ success: true, code: "SUCCESS", message: "Hello world" }, response);

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
        code: "PROCEDURE_ERROR",
        message: "Cannot read property 'me' of undefined",
    });
}

let { Allserver, HttpTransport, GrpcTransport, AllserverClient } = require("..");
Allserver = Allserver.props({ logger: { error() {} } }); // silence the servers

describe("integration", () => {
    describe("http", () => {
        const fetch = require("node-fetch");

        it("should behave with AllserverClient", async () => {
            const httpClient = AllserverClient({ uri: "http://localhost:4000", neverThrow: true });

            let response;
            response = await httpClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "CANNOT_REACH_REMOTE_PROCEDURE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");
            assert.strictEqual(response.error.code, "ECONNREFUSED");

            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 4000 }) });
            httpServer.start();

            await callClientMethods(httpClient);

            // HTTP-ony specific tests

            // Should return 404
            response = await httpClient.unexist();
            assert.strictEqual(response.code, "CANNOT_REACH_REMOTE_PROCEDURE");
            assert.strictEqual(response.error.status, 404);

            await httpServer.stop();
        });

        it("should behave with node-fetch", async () => {
            const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 4000 }) });
            httpServer.start();

            let response;

            response = await (
                await fetch("http://localhost:4000/sayHello", {
                    method: "POST",
                    body: JSON.stringify({ name: "world" }),
                })
            ).json();
            assert.deepStrictEqual(response, { success: true, code: "SUCCESS", message: "Hello world" });

            // HTTP-ony specific tests

            // Should return 400
            response = await fetch("http://localhost:4000/sayHello", {
                method: "POST",
                body: Buffer.allocUnsafe(999),
            });
            assert(!response.ok);
            assert.strictEqual(response.status, 400);

            // Should call using GET with query params
            response = await fetch("http://localhost:4000/sayHello?name=world");
            assert(response.ok);
            const body = await response.json();
            assert.deepStrictEqual(body, { success: true, code: "SUCCESS", message: "Hello world" });

            const httpClient = AllserverClient({ uri: "http://localhost:4000" });
            await callClientMethods(httpClient);
            await httpServer.stop();
        });
    });

    describe("grpc", () => {
        it("should behave with AllserverClient", async () => {
            const grpcClient = AllserverClient({ uri: "grpc://localhost:50051", neverThrow: true });

            let response;
            response = await grpcClient.sayHello({ name: "world" });
            assert.strictEqual(response.success, false);
            assert.strictEqual(response.code, "CANNOT_REACH_REMOTE_PROCEDURE");
            assert.strictEqual(response.message, "Couldn't reach remote procedure: sayHello");
            assert.strictEqual(response.error.message, "MISSING_GRPC_PROTO");

            const grpcServer = Allserver({
                procedures,
                transport: GrpcTransport({
                    protoFile: __dirname + "/allserver_integration_test.proto",
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
                transport: GrpcTransport({ protoFile: __dirname + "/allserver_integration_test.proto", port: 50051 }),
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
            assert.deepStrictEqual(response, { success: true, code: "SUCCESS", message: "Hello world" });

            await grpcServer.stop();
        });
    });
});
