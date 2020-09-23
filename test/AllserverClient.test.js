const assert = require("assert");

const VoidClientTransport = require("../src/client/ClientTransport").compose({
    methods: {
        introspect() {},
        call() {},
    },
});
const AllserverClient = require("..").AllserverClient.props({
    transport: VoidClientTransport({ uri: "void://localhost" }),
});

describe.skip("AllserverClient", () => {
    describe("#init", () => {
        it("should", () => {});
    });
});
