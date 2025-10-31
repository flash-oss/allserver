const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { LambdaClientTransport } = require("../..");

describe("LambdaClientTransport", () => {
    describe("#call", () => {
        it("should add response to context", async () => {
            const MockedTransport = LambdaClientTransport.props({
                awsSdkLambdaClient: {
                    async invoke({ FunctionName, Payload }) {
                        assert.equal(FunctionName, "my-function");
                        assert.deepEqual(JSON.parse(Payload), { _: { procedureName: "" } });
                        return {
                            Payload: Uint8Array.from(
                                Buffer.from(JSON.stringify({ success: true, code: "OK", message: "called" }))
                            ),
                        };
                    },
                },
            });
            const transport = MockedTransport({ uri: "lambda://my-function" });
            const ctx = transport.createCallContext({ arg: { _: { procedureName: "" } } });

            const result = await transport.call(ctx);

            assert(ctx.lambda?.response?.Payload instanceof Uint8Array);
            assert.deepEqual(result, { success: true, code: "OK", message: "called" });
        });

        it("should handle misconfiguration", async () => {
            class ProviderError extends Error {
                constructor(message) {
                    super(message);
                    this.name = "ProviderError";
                }
            }
            class NotFound extends Error {
                constructor(message) {
                    super(message);
                    this.name = "NotFound";
                }
            }

            for (const ErrorClass of [ProviderError, NotFound]) {
                const MockedTransport = LambdaClientTransport.props({
                    awsSdkLambdaClient: {
                        async invoke() {
                            throw new ErrorClass("ProviderError");
                        },
                    },
                });
                const transport = MockedTransport({ uri: "lambda://my-function" });
                const ctx = transport.createCallContext({ arg: { _: { procedureName: "" } } });

                let error;
                await transport.call(ctx).catch((err) => (error = err));

                assert(error);
                assert.equal(error.noNetToServer, true);
            }
        });

        it("should handle bad responses", async () => {
            const codeToPayloadMap = {
                ALLSERVER_RPC_RESPONSE_IS_NOT_JSON: "this is not a JSON",
                ALLSERVER_RPC_RESPONSE_IS_NOT_OBJECT: JSON.stringify([]),
                ALLSERVER_RPC_RESPONSE_IS_EMPTY_OBJECT: JSON.stringify({}),
            };

            for (const [expectedCode, payloadAsString] of Object.entries(codeToPayloadMap)) {
                const MockedTransport = LambdaClientTransport.props({
                    awsSdkLambdaClient: {
                        async invoke() {
                            return {
                                Payload: Uint8Array.from(Buffer.from(payloadAsString)),
                            };
                        },
                    },
                });
                const transport = MockedTransport({ uri: "lambda://my-function" });
                const ctx = transport.createCallContext({ arg: { _: { procedureName: "" } } });

                let error;
                await transport.call(ctx).catch((err) => (error = err));

                assert(error);
                assert(ctx.lambda?.response?.Payload instanceof Uint8Array);
                assert.equal(error.code, expectedCode);
            }
        });
    });
});
