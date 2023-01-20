module.exports = require("./Transport").compose({
    name: "BullmqTransport",

    props: {
        Worker: require("bullmq").Worker,
        _worker: null,
        _queueName: null,
        _connectionOptions: null,
        _workerOptions: null,
    },

    init({ queueName = "Allserver", connectionOptions, workerOptions }) {
        if (!connectionOptions) {
            connectionOptions = { host: "localhost", port: 6379 };
        }
        this._queueName = queueName || this._queueName;
        this._connectionOptions = connectionOptions || this._connectionOptions;
        this._workerOptions = workerOptions || this._workerOptions || {};
        if (this._workerOptions.autorun === undefined) this._workerOptions.autorun = true;
    },

    methods: {
        async startServer(defaultCtx) {
            this._worker = new this.Worker(
                this._queueName,
                async (job) => {
                    const ctx = { ...defaultCtx, bullmq: { job }, arg: job.data };
                    return await ctx.allserver.handleCall(ctx);
                },
                {
                    connection: this._connectionOptions,
                    ...this._workerOptions,
                }
            );
            return await this._worker.waitUntilReady();
        },

        reply(ctx) {
            return ctx.result;
        },

        async stopServer() {
            return this._worker.close();
        },

        getProcedureName(ctx) {
            return ctx.bullmq.job.name;
        },

        isIntrospection(ctx) {
            return this.getProcedureName(ctx) === "introspect"; // could be conflicting with procedure name(s)
        },
    },
});
