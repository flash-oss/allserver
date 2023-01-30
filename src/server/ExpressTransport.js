const { parse: parseUrl } = require("url");

module.exports = require("./Transport").compose({
    name: "ExpressTransport",

    props: {
        _express: require("express"),
    },

    methods: {
        async deserializeRequest(ctx) {
            if (ctx.http.req.deserializationFailed) return false;
            // If there is no body we will use request query (aka search params)
            let arg = ctx.http.query;
            if (ctx.http.req.body && Object.keys(ctx.http.req.body).length > 0) arg = ctx.http.req.body;
            ctx.arg = arg;
            return true;
        },

        async _handleRequest(ctx) {
            if (await this.deserializeRequest(ctx)) {
                await ctx.allserver.handleCall(ctx);
            } else {
                // HTTP protocol request was malformed (not expected structure).
                // We are not going to process it.
                ctx.result = { success: false, code: "ALLSERVER_BAD_REQUEST", message: "Can't parse JSON" };
                ctx.http.statusCode = 400;
                this.reply(ctx);
            }
        },

        startServer(defaultCtx) {
            return [
                this._express.json(),
                (err, req, res, next) => {
                    if (err.statusCode) req.deserializationFailed = err; // overriding the error, processing the request as normal
                    next();
                },
                async (req, res) => {
                    const ctx = {
                        ...defaultCtx,
                        http: { req, res, query: req.query || {} },
                    };

                    await this._handleRequest(ctx);
                },
            ];
        },

        getProcedureName(ctx) {
            return parseUrl(ctx.http.req.url).pathname.substr(1);
        },

        isIntrospection(ctx) {
            return this.getProcedureName(ctx) === "";
        },

        prepareNotFoundReply(ctx) {
            ctx.http.statusCode = 404;
        },
        prepareProcedureErrorReply(ctx) {
            // Generic exception.
            ctx.http.statusCode = 500;

            // nodejs assert() exception. In HTTP world this likely means 400 "Bad Request".
            if (ctx.error.code === "ERR_ASSERTION") ctx.http.statusCode = 400;
        },

        reply(ctx) {
            if (!ctx.http.statusCode) ctx.http.statusCode = 200;
            ctx.http.res.status(ctx.http.statusCode).json(ctx.result);
        },
    },
});
