module.exports = require("./ClientTransport").compose({
    name: "MemoryClientTransport",

    props: {
        _allserverContext: null,
        uri: "memory",
    },

    init({ allserverContext }) {
        this._allserverContext = allserverContext || this._allserverContext;
    },

    methods: {
        async introspect(ctx) {
            ctx.procedureName = "";
            const result = await this.call(ctx);
            if (!result) throw Error(); // The ClientTransport expects us to throw if call fails
            return result;
        },

        async call(ctx) {
            return this._allserverContext.allserver.handleCall(ctx);
        },

        createCallContext(defaultCtx) {
            return { ...defaultCtx, ...this._allserverContext, memory: {} };
        },
    },
});
