const procedures = {
    createUser({ firstName, lastName }) {
        // call database ...
        return { success: true, code: "CREATED", user: { id: String(Math.random()).substr(2) } };
    },
    gates: [
        function () {},
        function () {
            return 42;
        },
        function thirdGate() {
            return {
                name: "Golden Gate",
                lastVehicle: "0 seconds ago",
            };
        },
    ],
    getArg(arg) {
        return arg;
    },
    throws() {
        this.ping.me();
    },
    introspection: {
        enable(_, { allserver }) {
            allserver.introspection = true;
        },
        disable(_, { allserver }) {
            allserver.introspection = false;
        },
    },
    SayHello({ name }) {
        return "Hello " + name;
    },
};

const Allserver = require("..").Allserver;

// Allserver({ procedures }).start();

const loadOptions = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true };
const packageDefinition = require("@grpc/proto-loader").loadSync(__dirname + "/helloworld.proto", loadOptions);
Allserver({ procedures, protocol: require("..").GrpcProtocol({ packageDefinition }) }).start();

setTimeout(() => {
    var grpc = require("@grpc/grpc-js");
    var hello_proto = grpc.loadPackageDefinition(packageDefinition).helloworld;
    var client = new hello_proto.Greeter("localhost:4000", grpc.credentials.createInsecure());
    var user = "world";
    client.sayHello({ name: user }, function (err, response) {
        if (err) console.error(err);
        else console.log("Greeting:", response.message);
    });
    client.introspect({}, function (err, response) {
        if (err) console.error(err);
        else console.log("Procedures:", response.procedures);
    });
}, 1000);
