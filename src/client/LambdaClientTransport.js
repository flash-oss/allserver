module.exports = require("./ClientTransport").compose({
    name: "LambdaClientTransport",

    props: {
        awsSdkLambdaClient: null,
    },

    init() {
        if (!this.awsSdkLambdaClient) {
            let Lambda;
            try {
                Lambda = require("aws-sdk").Lambda; // AWS SDK v2 adoption
            } catch {
                Lambda = require("@aws-sdk/client-lambda").Lambda;
            }

            this.awsSdkLambdaClient = new Lambda();
        }
    },

    methods: {
        async introspect(ctx) {
            ctx.procedureName = "";
            const result = await this.call(ctx);
            // The server-side Transport will not have the call result if introspection is not available on the server side,
            // but the server itself is up and running processing calls.
            if (!result.procedures) throw Error("The lambda introspection call returned nothing"); // The ClientTransport expects us to throw if call fails
            return result;
        },

        async call(ctx) {
            let promise = this.awsSdkLambdaClient.invoke({
                FunctionName: this.uri.substring("lambda://".length),
                // TODO: change to this during the next major release:
                //  Payload: JSON.stringify(ctx.arg),
                Payload: JSON.stringify({
                    callContext: { ...ctx.lambda.callContext, procedureName: ctx.procedureName },
                    callArg: ctx.lambda.callArg,
                    ...ctx.arg,
                }),
            });
            if (typeof promise.promise === "function") promise = promise.promise(); // AWS SDK v2 adoption
            const invocationResponse = await promise;
            return JSON.parse(Buffer.from(invocationResponse.Payload));
        },

        createCallContext(defaultCtx) {
            return {
                ...defaultCtx,
                // TODO: change to this during the next major release:
                //  lambda: {}
                lambda: {
                    callContext: {},
                    callArg: defaultCtx.arg,
                },
            };
        },
    },
});
