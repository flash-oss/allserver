module.exports = require("./ClientTransport").compose({
    name: "LambdaClientTransport",

    props: {
        awsSdkLambdaClient: null,
    },

    init() {
        if (!this.awsSdkLambdaClient) {
            const { Lambda } = require("@aws-sdk/client-lambda");
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
            let invocationResponse;
            try {
                invocationResponse = await this.awsSdkLambdaClient.invoke({
                    FunctionName: this.uri.substring("lambda://".length),
                    Payload: JSON.stringify(ctx.arg),
                });
                ctx.lambda.response = invocationResponse;
            } catch (e) {
                if (e.name.includes("ProviderError") || e.name.includes("NotFound")) e.noNetToServer = true;
                throw e;
            }

            let json;
            try {
                json = JSON.parse(Buffer.from(invocationResponse.Payload));
            } catch (e) {
                e.code = "ALLSERVER_RPC_RESPONSE_IS_NOT_JSON";
                throw e;
            }

            const error = new Error("Bad response payload");
            if (json.constructor !== Object) {
                error.code = "ALLSERVER_RPC_RESPONSE_IS_NOT_OBJECT";
                throw error;
            }

            // Yes, the AWS Lambda sometimes returns a empty object when the Lambda runtime shuts down abruptly for no apparent reason.
            if (Object.keys(json).length === 0) {
                error.code = "ALLSERVER_RPC_RESPONSE_IS_EMPTY_OBJECT";
                throw error;
            }

            return json;
        },

        createCallContext(defaultCtx) {
            return {
                ...defaultCtx,
                lambda: {},
            };
        },
    },
});
