module.exports = require("stampit")({
    name: "Transport",

    methods: {
        // async startServer(defaultCtx) {},

        async stopServer() {},

        // getProcedureName(ctx) {},

        // isIntrospection(ctx) {},

        async prepareNotFoundReply(/* ctx */) {},
        async prepareProcedureErrorReply(/* ctx */) {},
        async prepareIntrospectionReply(/* ctx */) {},

        // reply(/* ctx */) {},
    },
});
