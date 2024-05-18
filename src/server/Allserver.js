const assert = require("assert");

const { isObject, isBoolean, isFunction } = require("../util");

module.exports = require("stampit")({
    name: "Allserver",

    props: {
        procedures: {},
        transport: null,
        logger: console,
        introspection: true,
        before: null,
        after: null,

        callsCount: 0,
    },

    init({ procedures, transport, introspection, before, after, logger }) {
        this.procedures = procedures || this.procedures;
        this.transport = transport || this.transport || require("./HttpTransport")();
        this.logger = logger || this.logger;
        this.introspection = introspection != null ? introspection : this.introspection;
        this.before = before || this.before;
        this.after = after || this.after;

        this._validateProcedures();
    },

    methods: {
        _validateProcedures() {
            assert(isObject(this.procedures), "'procedures' must be an object");
            assert(Object.values(this.procedures).every(isFunction), "All procedures must be functions");
        },

        async _introspect(ctx) {
            const allow = isFunction(this.introspection) ? this.introspection(ctx) : this.introspection;
            if (!allow) return;

            const obj = {};
            for (const [key, value] of Object.entries(this.procedures)) obj[key] = typeof value;
            ctx.introspection = obj;

            ctx.result = {
                success: true,
                code: "ALLSERVER_INTROSPECTION",
                message: "Introspection as JSON string",
                procedures: JSON.stringify(ctx.introspection),
            };
            await this.transport.prepareIntrospectionReply(ctx);
        },

        /**
         * This method does not throw.
         * The `ctx.procedure` is the function to call.
         * @param ctx
         * @return {Promise<void>}
         * @private
         */
        async _callProcedure(ctx) {
            if (!isFunction(ctx.procedure)) {
                ctx.result = {
                    success: false,
                    code: "ALLSERVER_PROCEDURE_NOT_FOUND",
                    message: `Procedure '${ctx.procedureName}' not found`,
                };
                await this.transport.prepareNotFoundReply(ctx);
                return;
            }

            let result;
            try {
                result = await ctx.procedure(ctx.arg, ctx);
            } catch (err) {
                const code = err.code || "ALLSERVER_PROCEDURE_ERROR";
                this.logger.error(err, code);
                ctx.error = err;
                ctx.result = {
                    success: false,
                    code,
                    message: `'${err.message}' error in '${ctx.procedureName}' procedure`,
                };
                await this.transport.prepareProcedureErrorReply(ctx);
                return;
            }

            if (result === undefined) {
                ctx.result = { success: true, code: "SUCCESS", message: "Success" };
            } else if (!result || !isBoolean(result.success)) {
                ctx.result = {
                    success: true,
                    code: "SUCCESS",
                    message: "Success",
                    [ctx.procedureName]: result,
                };
            } else {
                ctx.result = result;
            }
        },

        async _callMiddlewares(ctx, middlewareType, next) {
            const runMiddlewares = async (middlewares) => {
                if (!middlewares?.length) {
                    // no middlewares to run
                    if (next) return await next();
                    return;
                }
                const middleware = middlewares[0];
                async function handleMiddlewareResult(result) {
                    if (result !== undefined) {
                        ctx.result = result;
                        // Do not call any more middlewares
                    } else {
                        await runMiddlewares(middlewares.slice(1));
                    }
                }
                try {
                    if (middleware.length > 1) {
                        // This middleware accepts more than one argument
                        await middleware.call(this, ctx, handleMiddlewareResult);
                    } else {
                        const result = await middleware.call(this, ctx);
                        await handleMiddlewareResult(result);
                    }
                } catch (err) {
                    const code = err.code || "ALLSERVER_MIDDLEWARE_ERROR";
                    this.logger.error(err, code);
                    ctx.error = err;
                    ctx.result = {
                        success: false,
                        code,
                        message: `'${err.message}' error in '${middlewareType}' middleware`,
                    };
                    // Do not call any more middlewares
                    if (next) return await next();
                }
            };

            const middlewares = [].concat(this[middlewareType]).filter(isFunction);

            return await runMiddlewares(middlewares);
        },

        async handleCall(ctx) {
            ctx.callNumber = this.callsCount;
            this.callsCount += 1;
            ctx.procedureName = this.transport.getProcedureName(ctx);
            ctx.isIntrospection = this.transport.isIntrospection(ctx);
            if (!ctx.isIntrospection && ctx.procedureName) ctx.procedure = this.procedures[ctx.procedureName];

            if (!ctx.arg) ctx.arg = {};
            if (!ctx.arg._) ctx.arg._ = {};
            if (!ctx.arg._.procedureName) ctx.arg._.procedureName = ctx.procedureName;

            await this._callMiddlewares(ctx, "before", async () => {
                if (!ctx.result) {
                    if (ctx.isIntrospection) {
                        await this._introspect(ctx);
                    } else {
                        await this._callProcedure(ctx);
                    }
                }

                // Warning! This call might overwrite an existing result.
                await this._callMiddlewares(ctx, "after");
            });

            return this.transport.reply(ctx);
        },

        start() {
            return this.transport.startServer({ allserver: this });
        },
        stop() {
            return this.transport.stopServer();
        },
    },

    statics: {
        defaults({ procedures, transport, logger, introspection, before, after } = {}) {
            return this.props({ procedures, transport, logger, introspection, before, after });
        },
    },
});
