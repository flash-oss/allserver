module.exports = require("stampit")({
    name: "Allserver",

    props: {
        logger: console,
        callsCount: 0,
        transport: null,
        procedures: {},
        introspection: () => true,
        before: () => {},
        after: () => {},
    },

    init({ procedures, transport, introspection, before, after, logger }) {
        this.transport = transport || this.transport || require("./HttpTransport")();
        this.procedures = procedures || this.procedures;
        this.introspection = introspection != null ? introspection : this.introspection;
        this.before = before || this.before;
        this.after = after || this.after;
        this.logger = logger || this.logger;
    },

    methods: {
        _introspect(ctx, procedure) {
            const on = this.introspection;
            if (!on || (typeof on === "function" && !on(ctx))) {
                return;
            }

            const obj = {};
            for (const [key, value] of Object.entries(procedure || ctx.procedure)) {
                obj[key] = typeof value;
                // array or object
                if (value && obj[key] === "object") obj[key] = this._introspect(ctx, value);
            }

            return obj;
        },

        async _callProcedure(ctx) {
            if (typeof ctx.procedure !== "function") {
                await this.transport.prepareNotFoundReply(ctx);
                return;
            }

            let result;
            try {
                result = await ctx.procedure(ctx.arg, ctx);
            } catch (err) {
                this.logger.error("PROCEDURE_ERROR", err);
                ctx.error = err;
                await this.transport.prepareProcedureErrorReply(ctx);
                return;
            }

            if (result === undefined) {
                ctx.result = { success: true, code: "SUCCESS", message: "Success" };
            } else if (result && typeof result === "string") {
                ctx.result = { success: true, code: "SUCCESS", message: result };
            } else if (!result || typeof result.success !== "boolean") {
                ctx.result = {
                    success: true,
                    code: "SUCCESS",
                    message: "Success",
                    [ctx.procedure.name || ctx.procedureName]: result,
                };
            } else {
                ctx.result = result;
            }
        },

        async handleCall(ctx) {
            ctx.callNumber = this.callsCount;
            this.callsCount += 1;
            ctx.procedureName = this.transport.getProcedureName(ctx);
            ctx.procedure = ctx.procedureName ? this.procedures[ctx.procedureName] : this.procedures;

            if (this.before) {
                const result = await this.before(ctx);
                if (result !== undefined) {
                    ctx.result = result;
                }
            }

            if (!ctx.result) {
                // object or array -> introspect
                if (ctx.procedure && typeof ctx.procedure === "object") {
                    ctx.introspection = this._introspect(ctx);
                    await this.transport.prepareIntrospectionReply(ctx);
                }
            }

            if (!ctx.result) {
                // function -> call it
                await this._callProcedure(ctx);
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
