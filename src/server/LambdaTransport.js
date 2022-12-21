module.exports = require("./Transport").compose({
    name: "LambdaTransport",

    props: {
        _mapProceduresToExports: false,
    },

    init({ mapProceduresToExports }) {
        this._mapProceduresToExports = mapProceduresToExports || this._mapProceduresToExports;
    },

    methods: {
        async deserializeRequest(ctx) {
            const body = ctx.lambda.event.body;
            let arg = ctx.lambda.query;
            try {
                // If there is no body we will use request query (aka search params)
                if (body) arg = JSON.parse(body);
                ctx.arg = arg;
                return true;
            } catch (err) {
                return false;
            }
        },

        async _handleRequest(ctx) {
            if (await this.deserializeRequest(ctx)) {
                await ctx.allserver.handleCall(ctx);
            } else {
                // HTTP protocol request was malformed (not expected structure).
                // We are not going to process it.
                ctx.result = { success: false, code: "ALLSERVER_BAD_REQUEST", message: "Can't parse JSON" };
                ctx.lambda.statusCode = 400;
                this.reply(ctx);
            }
        },

        startServer(defaultCtx) {
            if (this._mapProceduresToExports) {
                const exports = {};
                for (const procedureName of Object.keys(defaultCtx.allserver.procedures)) {
                    exports[procedureName] = async (event) =>
                        new Promise((resolve) => {
                            const path = "/" + procedureName;
                            const ctx = {
                                ...defaultCtx,
                                lambda: { event, resolve, path, query: { ...(event.queryStringParameters || {}) } },
                            };

                            this._handleRequest(ctx);
                        });
                }
                return exports;
            }

            return async (event) => {
                return new Promise((resolve) => {
                    const ctx = {
                        ...defaultCtx,
                        lambda: { event, resolve, path: event.path, query: { ...(event.queryStringParameters || {}) } },
                    };

                    this._handleRequest(ctx);
                });
            };
        },

        getProcedureName(ctx) {
            return ctx.lambda.path.substr(1);
        },

        isIntrospection(ctx) {
            return this.getProcedureName(ctx) === "";
        },

        prepareProcedureErrorReply(ctx) {
            // Generic exception.
            ctx.lambda.statusCode = 500;

            // nodejs assert() exception. In HTTP world this likely means 400 "Bad Request".
            if (ctx.error.code === "ERR_ASSERTION") ctx.lambda.statusCode = 400;
        },
        prepareNotFoundReply(ctx) {
            ctx.lambda.statusCode = 404;
        },

        reply(ctx) {
            if (!ctx.lambda.statusCode) ctx.lambda.statusCode = 200;
            ctx.lambda.resolve({
                statusCode: ctx.lambda.statusCode,
                headers: { "content-type": "application/json" },
                body: JSON.stringify(ctx.result),
            });
        },
    },
});
