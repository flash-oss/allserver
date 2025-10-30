module.exports = require("../../ClientTransport").compose({
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
            const result = await this.call(this.createCallContext({ procedureName: "" }));
            // The server-side Transport will not have the call result if introspection is not available on the server side,
            // but the server itself is up and running processing calls.
            if (!result.procedures) throw Error("The lambda introspection call returned nothing"); // The ClientTransport expects us to throw if call fails
            return result;
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
                    } catch {
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
