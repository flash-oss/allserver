// Your universal procedures.
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

const { Allserver, HttpTransport, GrpcTransport, AllserverClient } = require("..");

// HTTP

setTimeout(async () => {
    console.log("\nHTTP");

    const httpServer = Allserver({ procedures, transport: HttpTransport({ port: 4000 }) });
    httpServer.start();

    // const fetch = require("node-fetch");
    // const response = await (
    //     await fetch("http://localhost:4000/sayHello", { method: "POST", body: JSON.stringify({ name: user }) })
    // ).json();
    // console.log("Greeting:", response.message);
    const client = AllserverClient({ uri: "http://localhost:4000" });
    await client.call("introspection", { enable: false });

    console.log(1, await client.sayHello({ name: "world" }));
    console.log(2, await client.sayHello({ name: "world" }));
    // console.log(3, await client.unexist({ name: "world" }));
    // console.log(3, await client.unexist({ name: "world" }));

    await httpServer.stop();
}, 1);

// gRPC

setTimeout(async () => {
    console.log("\ngRPC");

    const packageDefinition = require("@grpc/proto-loader").loadSync(__dirname + "/allserver_example.proto");
    const grpcServer = Allserver({ procedures, transport: GrpcTransport({ packageDefinition, port: 50051 }) });
    await grpcServer.start();

    const grpc = require("@grpc/grpc-js");
    const hello_proto = grpc.loadPackageDefinition(packageDefinition).allserver_example;
    const client = new hello_proto.MyService("localhost:50051", grpc.credentials.createInsecure());
    const { promisify } = require("util");
    for (const k in client) if (typeof client[k] === "function") client[k] = promisify(client[k].bind(client));

    let response = await client.sayHello({ name: "world" });
    console.log("Greeting:", response.message);

    response = await client.introspect({});
    console.log("Procedures:", response.procedures);

    await client.introspection({ enable: false });
    console.log("Disabled introspection");
    response = await client.introspect({});
    console.log("Procedures:", response.procedures);
    await client.introspection({ enable: true });
    console.log("Enabled introspection");
    response = await client.introspect({});
    console.log("Procedures:", response.procedures);

    console.log("Gates 0, 1, 2, 3");
    for (const number of [0, 1, 2, 3]) console.log(await client.gate({ number }));

    response = await client.throws({});
    console.log("Throws:", response);

    await grpcServer.stop();
}, 1000);
