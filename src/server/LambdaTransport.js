module.exports = require("./Transport").compose({
    name: "LambdaTransport",

    methods: {
        async deserializeEvent(ctx) {
            if (ctx.lambda.isHttp) {
                const { body, query } = ctx.lambda.http;
                try {
                    // If there is no body we will use request query (aka search params)
                    if (!body) {
                        ctx.arg = query || {};
                    } else {
                        if ((typeof body === "string" && body[0] === "{") || Buffer.isBuffer(body)) {
                            ctx.arg = JSON.parse(body);
                        } else {
                            return false;
                        }
                    }
                    return true;
                } catch {
                    return false;
                }
            } else {
                ctx.arg = ctx.lambda.invoke || {};
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
                    const lambda = { event, context, resolve };

                    const path = (event && (event.path || event.requestContext?.http?.path)) || undefined;
                    lambda.isHttp = Boolean(path);

                    if (lambda.isHttp) {
                        lambda.http = {
                            path,
                            query: event?.queryStringParameters,
                            body: event?.body,
                            headers: event?.headers,
                        };
                    } else {
                        lambda.invoke = event || {};
                    }

                    this._handleRequest({ ...defaultCtx, lambda });
                });
            };
        },

        getProcedureName(ctx) {
            const { isHttp, http, invoke } = ctx.lambda;
            return (isHttp ? http.path.substr(1) : invoke._?.procedureName) || ""; // if no procedureName then it's an introspection
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
