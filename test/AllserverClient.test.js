const assert = require("assert");

const VoidTransport = require("../src/client/ClientTransport")({
    methods: {
        introspect() {},
        call() {},
    },
});
const AllserverClient = require("..").AllserverClient.props({
    transport: VoidTransport(),
    uri: "void://localhost",
});

describe.skip("AllserverClient", () => {
    describe("#init", () => {
        it("should", () => {});
    });
});
