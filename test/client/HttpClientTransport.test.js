const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { HttpClientTransport } = require("../..");

describe("HttpClientTransport", () => {
    describe("#init", () => {
        it("should accept uri without end slash", () => {
            const transport = HttpClientTransport({ uri: "http://bla" });

            assert.equal(transport.uri, "http://bla/");
        });

        it("should assign headers", () => {
            const transport = HttpClientTransport({ uri: "http://bla", headers: { authorization: "Basic token" } });

            const ctx = transport.createCallContext({});

            assert.equal(ctx.http.headers.authorization, "Basic token");
        });
    });

    describe("#call", () => {
        it("should add response to context", async () => {
            const MockedTransport = HttpClientTransport.props({
                async fetch(uri, options) {
                    assert.equal(uri, "http://localhost/");
                    assert.equal(options.method, "POST");
                    return new globalThis.Response(JSON.stringify({ success: true, code: "OK", message: "called" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    });
                },
            });

            const transport = MockedTransport({ uri: "http://localhost" });

            const ctx = transport.createCallContext({ procedureName: "" });
            const result = await transport.call(ctx);

            assert(ctx.http.response instanceof globalThis.Response);
            assert.deepEqual(result, { success: true, code: "OK", message: "called" });
        });
    });
});
