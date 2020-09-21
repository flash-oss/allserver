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

const { Allserver, GrpcTransport } = require("..");

// Allserver({ procedures }).start();

const packageDefinition = require("@grpc/proto-loader").loadSync(__dirname + "/allserver_example.proto");
Allserver({ procedures, transport: GrpcTransport({ packageDefinition }) }).start();

setTimeout(async () => {
    var grpc = require("@grpc/grpc-js");
    var hello_proto = grpc.loadPackageDefinition(packageDefinition).allserver_example;
    var client = new hello_proto.MyService("localhost:4000", grpc.credentials.createInsecure());
    const { promisify } = require("util");
    for (const k in client) if (typeof client[k] === "function") client[k] = promisify(client[k].bind(client));

    var user = "world";
    let response = await client.sayHello({ name: user });
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
}, 1000);
