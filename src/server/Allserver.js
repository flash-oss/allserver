const assert = require("assert");

const { isObject, isString, isBoolean, isFunction } = require("../util");

module.exports = require("stampit")({
    name: "Allserver",

    props: {
        logger: console,
        callsCount: 0,
        transport: null,
        procedures: {},
        introspection: true,
        before: null,
        after: null,
    },

    init({ procedures, transport, introspection, before, after, logger }) {
        this.transport = transport || this.transport || require("./HttpTransport")();
        this.procedures = procedures || this.procedures;
        this.introspection = introspection != null ? introspection : this.introspection;
        this.before = before || this.before;
        this.after = after || this.after;
        this.logger = logger || this.logger;

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
                code: "OK",
                message: "Introspection as JSON string",
                procedures: JSON.stringify(ctx.introspection),
            };
            await this.transport.prepareIntrospectionReply(ctx);
        },

        async _callProcedure(ctx) {
            if (!isFunction(ctx.procedure)) {
                ctx.result = {
                    success: false,
                    code: "PROCEDURE_NOT_FOUND",
                    message: `Procedure ${ctx.procedureName} not found`,
                };
                await this.transport.prepareNotFoundReply(ctx);
                return;
            }

            let result;
            try {
                result = await ctx.procedure(ctx.arg, ctx);
            } catch (err) {
                this.logger.error("PROCEDURE_ERROR", err);
                ctx.error = err;
                ctx.result = { success: false, code: err.code || "PROCEDURE_ERROR", message: err.message };
                return;
            }

            if (result === undefined) {
                ctx.result = { success: true, code: "SUCCESS", message: "Success" };
            } else if (result && isString(result)) {
                ctx.result = { success: true, code: "SUCCESS", message: result };
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

        async handleCall(ctx) {
            ctx.callNumber = this.callsCount;
            this.callsCount += 1;
            ctx.procedureName = this.transport.getProcedureName(ctx);
            ctx.isIntrospection = this.transport.isIntrospection(ctx);
            if (!ctx.isIntrospection && ctx.procedureName) ctx.procedure = this.procedures[ctx.procedureName];

            if (this.before) {
                const result = await this.before(ctx);
                if (result !== undefined) {
                    ctx.result = result;
                }
            }

            if (!ctx.result) {
                if (ctx.isIntrospection) {
                    await this._introspect(ctx);
                } else {
                    await this._callProcedure(ctx);
                }
            }

            if (this.after) {
                const result = await this.after(ctx);
                if (result !== undefined) {
                    // Warning! Overwriting the result.
                    ctx.result = result;
                }
            }

            this.transport.reply(ctx);
        },

        start() {
            return this.transport.startServer({ allserver: this });
        },
        stop() {
            return this.transport.stopServer();
        },
    },
});
