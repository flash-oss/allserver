const assert = require("assert");

const { HttpClientTransport } = require("../../src");

describe("HttpClientTransport", () => {
    describe("#init", () => {
        it("should accept uri without end slash", () => {
            const transport = HttpClientTransport({ uri: "http://bla" });

            assert.strictEqual(transport.uri, "http://bla/");
        });

        it("should assign headers", () => {
            const transport = HttpClientTransport({ uri: "http://bla", headers: { authorization: "Basic token" } });

            const ctx = transport.createCallContext({});

            assert.strictEqual(ctx.http.headers.authorization, "Basic token");
        });
    });

    describe("#call", () => {
        it("should add response to context", async () => {
            const { Response } = require("node-fetch");
            const MockedTransport = HttpClientTransport.props({
                async fetch(uri, options) {
                    assert.strictEqual(uri, "http://localhost/");
                    assert.strictEqual(options.method, "POST");
                    const response = new Response();
                    response.json = () => ({ success: true, code: "OK", message: "called" });
                    return response;
                },
            });

            const transport = MockedTransport({ uri: "http://localhost" });

            const ctx = transport.createCallContext({ procedureName: "" });
            const result = await transport.call(ctx);

            assert(ctx.http.response instanceof Response);
            assert.deepStrictEqual(result, { success: true, code: "OK", message: "called" });
        });
    });
});
