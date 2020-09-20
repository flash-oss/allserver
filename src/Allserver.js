function deepGet(object, path) {
    if (!path || !path.split) return object;
    const props = path.split("."); // E.g. "users.documents.0"
    while (props.length !== 1) object = object[props.shift()];
    return object && object[props[0]];
}

module.exports = require("stampit")({
    name: "Allserver",

    props: {
        callsCount: 0,
        protocol: null,
        procedures: {},
        introspection: () => true,
        before: () => {},
        after: () => {},
    },

    init({ procedures, protocol, introspection, before, after }) {
        this.protocol = protocol || require("./HttpProtocol")();
        this.procedures = procedures || this.procedures;
        this.introspection = introspection != null ? introspection : this.introspection;
        this.before = before || this.before;
        this.after = after || this.after;
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
            let result;
            try {
                result = await ctx.procedure(ctx.arg, ctx);
            } catch (err) {
                console.error("PROCEDURE_ERROR", err);
                ctx.error = err;
                this.protocol.prepareProcedureErrorReply(ctx);
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
            }
        },

        async handleCall(ctx) {
            ctx.callNumber = this.callsCount;
            this.callsCount += 1;
            ctx.procedureName = this.protocol.getProcedureName(ctx);
            ctx.procedure = deepGet(ctx.allserver.procedures, ctx.procedureName);

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
                    this.protocol.prepareIntrospectionReply(ctx);
                }
            }

            if (!ctx.result) {
                // Something unexpected -> 404
                if (typeof ctx.procedure !== "function") {
                    this.protocol.prepareNotFoundReply(ctx);
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

            this.protocol.reply(ctx);
        },

        start() {
            return this.protocol.startServer({ allserver: this });
        },
    },
});
