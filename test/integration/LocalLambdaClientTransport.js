module.exports = require("../../src/client/ClientTransport").compose({
    name: "LocalLambdaClientTransport",

    props: {
        _lambdaLocal: require("lambda-local"),
        _lambdaHandler: null,
    },

    init({ lambdaHandler }) {
        if (!this.uri.endsWith("/")) this.uri += "/";
        this._lambdaHandler = lambdaHandler || this._lambdaHandler;

        this._lambdaLocal.setLogger({ log() {}, transports: [] }); // silence logs
    },

    methods: {
        async introspect() {
            return this.call(this.createCallContext({ procedureName: "" }));
        },

        async call({ procedureName = "", arg }) {
            let response = await this._lambdaLocal.execute({
                event: {
                    body: arg && JSON.stringify(arg),
                    path: "/" + procedureName,
                },
                lambdaFunc: { handler: this._lambdaHandler },
            });

            if (response.statusCode !== 200) {
                const text = response.body || "";
                let error;
                if (text[0] === "{" && text[text.length - 1] === "}") {
                    try {
                        const json = JSON.parse(text);
                        const message = (json && json.message) || text;
                        error = new Error(message);
                        if (json && json.code) error.code = json.code;
                    } catch (err) {
                        // ignoring. Not a JSON
                    }
                }
                if (!error) error = new Error(text);
                error.status = response.statusCode;
                throw error;
            }

            try {
                return JSON.parse(response.body);
            } catch (err) {
                err.code = "RPC_RESPONSE_IS_NOT_JSON";
                throw err;
            }
        },

        createCallContext(defaultCtx) {
            return { ...defaultCtx, lambda: {} };
        },
    },
});
