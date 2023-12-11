module.exports = require("./Transport").compose({
    name: "LambdaTransport",

    methods: {
        async deserializeEvent(ctx) {
            if (ctx.lambda.isHttp) {
                const body = ctx.lambda.event.body;
                let query = ctx.lambda.query;
                try {
                    // If there is no body we will use request query (aka search params)
                    ctx.arg = body ? JSON.parse(body) : query;
                    return true;
                } catch (err) {
                    return false;
                }
            } else {
                ctx.arg = ctx.lambda.event || {};
                return true;
            }
        },

        async _handleRequest(ctx) {
            if (await this.deserializeEvent(ctx)) {
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
            return async (event, context) => {
                return new Promise((resolve) => {
                    const path = (event && (event.path || event.requestContext?.http?.path)) || undefined;
                    const isHttp = Boolean(path);
                    const procedureName = isHttp ? path.substr(1) : context.clientContext?.procedureName;
                    const query = { ...(event?.queryStringParameters || {}) };
                    const lambda = { resolve, isHttp, event, context, path, query, procedureName };

                    this._handleRequest({ ...defaultCtx, lambda });
                });
            };
        },

        getProcedureName({ lambda: { procedureName } }) {
            return procedureName;
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
            if (ctx.lambda.isHttp) {
                if (!ctx.lambda.statusCode) ctx.lambda.statusCode = 200;
                ctx.lambda.resolve({
                    statusCode: ctx.lambda.statusCode,
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(ctx.result),
                });
            } else {
                ctx.lambda.resolve(ctx.result);
            }
        },
    },
});
