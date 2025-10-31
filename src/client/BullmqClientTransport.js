module.exports = require("./ClientTransport").compose({
    name: "BullmqClientTransport",

    props: {
        Queue: require("bullmq").Queue,
        QueueEvents: require("bullmq").QueueEvents,
        _queue: null,
        _queueEvents: null,
        _jobsOptions: null,
    },

    init({ queueName = "Allserver", connectionOptions, timeout, jobsOptions }) {
        if (!connectionOptions) {
            const bullmqUrl = new URL(this.uri);
            connectionOptions = {
                host: bullmqUrl.hostname,
                port: bullmqUrl.port,
                username: bullmqUrl.username,
                password: bullmqUrl.password,
                db: Number(bullmqUrl.pathname.substr(1)) || 0,
                retryStrategy: null, // only one attempt to connect
            };
        }

        this._queue = new this.Queue(queueName, { connection: connectionOptions });
        this._queue.on("error", () => {}); // The only reason we subscribe is to avoid bullmq to print errors to console
        this._queueEvents = new this.QueueEvents(queueName, { connection: connectionOptions });
        this._queueEvents.on("error", () => {}); // The only reason we subscribe is to avoid bullmq to print errors to console

        this._jobsOptions = jobsOptions || {};
        if (this._jobsOptions.removeOnComplete === undefined) this._jobsOptions.removeOnComplete = 100;
        if (this._jobsOptions.removeOnFail === undefined) this._jobsOptions.removeOnFail = 100;
        if (this._jobsOptions.sizeLimit === undefined) this._jobsOptions.sizeLimit = 524288; // max data JSON size is 512KB
    },

    methods: {
        async introspect(ctx) {
            ctx.procedureName = "introspect";
            const jobReturnResult = await this.call(ctx);
            // The server-side Transport will not have job result if introspection is not available on the server side,
            // but the server itself is up and running processing calls.
            if (jobReturnResult == null) throw new Error("The bullmq introspection job returned nothing");
            return jobReturnResult;
        },

        async call({ procedureName, bullmq }) {
            try {
                await this._queue.waitUntilReady();
                const job = await bullmq.queue.add(procedureName, bullmq.data, bullmq.jobsOptions);
                return await job.waitUntilFinished(bullmq.queueEvents, this.timeout); // this.timeout is a property of the parent ClientTransport
            } catch (err) {
                if (err.code === "ECONNREFUSED") err.noNetToServer = true;
                throw err;
            }
        },

        createCallContext(defaultCtx) {
            return {
                ...defaultCtx,
                bullmq: {
                    data: defaultCtx.arg,
                    queue: this._queue,
                    queueEvents: this._queueEvents,
                    jobsOptions: this._jobsOptions,
                },
            };
        },
    },
});
