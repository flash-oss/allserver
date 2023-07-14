module.exports = require("./Transport").compose({
    name: "MemoryTransport",

    props: {
        AllserverClient: require("../client/AllserverClient"),
        MemoryClientTransport: require("../client/MemoryClientTransport"),
    },

    methods: {
        startServer(defaultCtx) {
            return this.AllserverClient({
                transport: this.MemoryClientTransport({ allserverContext: { ...defaultCtx, memory: {} } }),
            });
        },

        reply(ctx) {
            return ctx.result;
        },

        getProcedureName(ctx) {
            return ctx.procedureName;
        },

        isIntrospection(ctx) {
            return this.getProcedureName(ctx) === "";
        },
    },
});
