const assert = require("node:assert");
const { describe, it, afterEach } = require("node:test");

const cls = require("cls-hooked");
const spaceName = "allserver";
const session = cls.getNamespace(spaceName) || cls.createNamespace(spaceName);
function getTraceId() {
    if (session?.active) {
        return session.get("traceId") || "";
    }

    return "";
}
function setTraceIdAndRunFunction(traceId, func, ...args) {
    return new Promise((resolve, reject) => {
        session.run(async () => {
            session.set("traceId", traceId);

            try {
                const result = await func(...args);
                resolve(result);
            } catch (err) {
                reject(err);
            }
        });
    });
}

const VoidClientTransport = require("../..").ClientTransport.compose({
    props: {
        uri: "void://localhost",
    },
    methods: {
        introspect() {},
        call() {},
        createCallContext: (defaultCtx) => ({ ...defaultCtx, void: {} }),
    },
});
const AllserverClient = require("../..").AllserverClient.addTransport({
    schema: "void",
    Transport: VoidClientTransport,
});
const p = Symbol.for("AllserverClient"); // This would help us accessing protected properties.

describe("AllserverClient", () => {
    afterEach(() => {
        // clean introspection cache
        AllserverClient.compose.methods._introspectionCache = new Map();
    });

    describe("#addTransport", () => {
        it("should allow overwriting existing configured transports", () => {
            const AC = require("../..").AllserverClient;
            AC.addTransport({
                schema: "http",
                Transport: VoidClientTransport,
            });
        });
    });

    describe("#init", () => {
        it("should throw if no uri and no transport", () => {
            assert.throws(() => AllserverClient(), /uri/);
        });

        it("should throw if uri schema is not supported", () => {
            assert.throws(() => AllserverClient({ uri: "unexist://bla" }), /schema/i);
        });

        it("should work with http", () => {
            const client = AllserverClient({ uri: "http://bla/" });
            assert(client[p].transport.fetch); // duck typing
        });

        it("should work with https", () => {
            const client = AllserverClient({ uri: "https://bla" });
            assert(client[p].transport.fetch); // duck typing
        });

        it("should work with grpc", () => {
            const client = AllserverClient({ uri: "grpc://bla" });
            assert(client[p].transport._grpc); // duck typing
        });

        it("should work with third party added transports supported", () => {
            const client = AllserverClient({ uri: "void://bla" });
            assert.strictEqual(client[p].transport.uri, "void://bla");
        });

        it("should ignore case", () => {
            const client = AllserverClient({ uri: "VOID://bla" });
            assert.strictEqual(client[p].transport.uri, "VOID://bla");
        });

        it("should throw is schema is not supported", () => {
            assert.throws(
                () => AllserverClient({ uri: "no-schema-here" }),
                /`uri` must follow pattern: SCHEMA:\/\/URI/
            );
        });

        it("should throw is schema is not supported", () => {
            assert.throws(() => AllserverClient({ uri: "unexist://bla" }), /Schema not supported: unexist:\/\/bla/);
        });
    });

    describe("#introspect", () => {
        it("should not throw if underlying transport fails to connect", async () => {
            const MockedTransport = VoidClientTransport.methods({
                introspect: () => Promise.reject(new Error("Cannot reach server")),
            });

            const result = await AllserverClient({ transport: MockedTransport() }).introspect();
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_CLIENT_INTROSPECTION_FAILED");
            assert.strictEqual(result.message, "Couldn't introspect void://localhost due to: Cannot reach server");
            assert.strictEqual(result.error.message, "Cannot reach server");
        });

        it("should not throw if underlying transport returns malformed introspection", async () => {
            const MockedTransport = VoidClientTransport.methods({
                introspect: () => ({
                    success: true,
                    code: "ALLSERVER_INTROSPECTION",
                    message: "Introspection as JSON string",
                    procedures: "bad food",
                }),
            });

            const result = await AllserverClient({ transport: MockedTransport() }).testMethod();
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_CLIENT_MALFORMED_INTROSPECTION");
            assert.strictEqual(result.message, "Malformed introspection from void://localhost");
            assert(result.error.message.includes("Unexpected token"));
        });

        it("should not throw if underlying transport returns introspection in a wrong format", async () => {
            const MockedTransport = VoidClientTransport.methods({
                introspect: () => ({
                    success: true,
                    code: "ALLSERVER_INTROSPECTION",
                    message: "Introspection as JSON string",
                    procedures: "42",
                }),
            });

            const result = await AllserverClient({ transport: MockedTransport() }).testMethod();
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_CLIENT_MALFORMED_INTROSPECTION");
            assert.strictEqual(result.message, "Malformed introspection from void://localhost");
            assert(!result.error);
        });
    });

    describe("#call", () => {
        it("should throw if underlying transport fails to connect and neverThrow=false", async () => {
            const MockedTransport = VoidClientTransport.methods({
                call: () => Promise.reject(new Error("Cannot reach server")),
            });

            await assert.rejects(
                AllserverClient({ transport: MockedTransport(), neverThrow: false }).call(),
                /Cannot reach server/
            );
        });

        it("should throw if transport 'before' or 'after' middlewares throw and neverThrow=false", async () => {
            const transport = VoidClientTransport();
            const before = () => {
                throw new Error("before threw");
            };
            await assert.rejects(AllserverClient({ transport, neverThrow: false, before }).call(), /before threw/);

            const after = () => {
                throw new Error("after threw");
            };

            await assert.rejects(AllserverClient({ transport, neverThrow: false, after }).call(), /after threw/);
        });

        it("should not throw if neverThrow enabled (default behaviour)", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                call: () => Promise.reject(new Error("Cannot reach server")),
            });

            const result = await AllserverClient({ transport: MockedTransport() }).call("foo", {});
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(result.message, "Couldn't reach remote procedure foo due to: Cannot reach server");
            assert.strictEqual(result.error.message, "Cannot reach server");
        });

        it("should not throw if neverThrow enabled and the method is not present", async () => {
            const MockedTransport = VoidClientTransport.methods({
                call: () => Promise.reject(new Error("Shit happens too")),
            });

            const client = AllserverClient({ transport: MockedTransport() });
            assert.strictEqual(Reflect.has(client, "foo"), false); // don't have it
            const result = await client.call("foo", {});
            assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_CLIENT_PROCEDURE_UNREACHABLE");
            assert.strictEqual(result.message, "Couldn't reach remote procedure foo due to: Shit happens too");
            assert.strictEqual(result.error.message, "Shit happens too");
        });

        it("should return ALLSERVER_CLIENT_TIMEOUT code on timeouts", async () => {
            const MockedTransport = VoidClientTransport.methods({
                call: () => new Promise(() => {}), // never resolving or rejecting promise
            });

            const client = AllserverClient({ transport: MockedTransport(), timeout: 1 }); // 1 ms timeout for fast unit tests
            const result = await client.call("doesnt_matter");
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.code, "ALLSERVER_CLIENT_TIMEOUT");
            assert.strictEqual(result.message, "The remote procedure doesnt_matter timed out in 1 ms");
        });
    });

    describe("dynamicMethods", () => {
        it("should not do dynamic RPC based on object property names", () => {
            const client = AllserverClient({ dynamicMethods: false, uri: "void://bla" });
            assert.throws(() => client.thisMethodDoesNotExist());
        });

        it("should do dynamic RPC based on object property names", async () => {
            const client = AllserverClient({ autoIntrospect: false, uri: "void://bla" });
            await client.thisMethodDoesNotExist();
        });
    });

    describe("nameMapper", () => {
        it("should map and filter names", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ "get-rates": "function", "hide-me": "function" }),
                    };
                },
                async call({ procedureName, arg }) {
                    assert.strictEqual(procedureName, "getRates");
                    assert.deepStrictEqual(arg, { a: 1, _: { procedureName: "getRates" } });
                    return { success: true, code: "CALLED", message: "A is good", b: 42 };
                },
            });

            const nameMapper = (name) => name !== "hide-me" && name.replace(/(-\w)/g, (k) => k[1].toUpperCase());
            const client = AllserverClient({ transport: MockedTransport(), nameMapper });
            assert.strictEqual(Reflect.has(client, "getRates"), false); // dont have it yet
            const result = await client.getRates({ a: 1 });
            assert.strictEqual(Reflect.has(client, "getRates"), true); // have it now!
            assert.deepStrictEqual(result, { success: true, code: "CALLED", message: "A is good", b: 42 });
        });
    });

    describe("client middleware", () => {
        describe("'before'", () => {
            it("should call 'before'", async () => {
                let introspected = false;
                const MockedTransport = VoidClientTransport.methods({
                    async introspect(ctx) {
                        assert(ctx.isIntrospection);
                        introspected = true;
                        return {
                            success: true,
                            code: "OK",
                            message: "Ok",
                            procedures: JSON.stringify({ getRates: "function" }),
                        };
                    },
                    async call({ procedureName, arg }) {
                        assert.strictEqual(procedureName, "getRates");
                        assert.deepStrictEqual(arg, { a: 1, _: { procedureName: "getRates" } });
                        return { success: true, code: "CALLED", message: "A is good", b: 42 };
                    },
                });

                let beforeCalled = 0;
                function before(ctx) {
                    assert.strictEqual(this, client, "The `this` context must be the client itself");
                    if (ctx.isIntrospection) {
                        assert(!ctx.procedureName);
                    } else {
                        assert.strictEqual(ctx.procedureName, "getRates");
                        assert.deepStrictEqual(ctx.arg, { a: 1, _: { procedureName: "getRates" } });
                    }
                    beforeCalled += 1;
                }

                const client = AllserverClient({ transport: MockedTransport(), before });
                const result = await client.getRates({ a: 1 });
                assert.deepStrictEqual(result, { success: true, code: "CALLED", message: "A is good", b: 42 });
                assert.strictEqual(beforeCalled, 2);
                assert(introspected);
            });

            it("should allow result override in 'before'", async () => {
                let defaultMiddlewareCalled = false;
                const DefaultedAllserverClient = AllserverClient.defaults({
                    callIntrospectedProceduresOnly: false,
                    before() {
                        defaultMiddlewareCalled = true;
                    },
                });
                const before = () => {
                    return "Override result";
                };
                const client = DefaultedAllserverClient({ transport: VoidClientTransport(), before });
                assert.strictEqual(client[p].before.length, 2, "Default middleware should be present");
                const result = await client.foo();
                assert.deepStrictEqual(result, "Override result");
                assert.ok(defaultMiddlewareCalled);
            });

            it("should handle rejections from 'before'", async () => {
                const err = new Error("'before' is throwing");
                const before = () => {
                    throw err;
                };
                const client = AllserverClient({
                    transport: VoidClientTransport(),
                    before,
                    callIntrospectedProceduresOnly: false,
                });
                const result = await client.foo();
                assert.deepStrictEqual(result, {
                    success: false,
                    code: "ALLSERVER_CLIENT_MIDDLEWARE_ERROR",
                    message: "The 'before' middleware error while calling 'foo' procedure: 'before' is throwing",
                    error: err,
                });
            });

            it("should override code if 'before' error has it", async () => {
                const err = new Error("'before' is throwing");
                err.code = "OVERRIDE_CODE";
                const before = () => {
                    throw err;
                };
                const client = AllserverClient({
                    transport: VoidClientTransport(),
                    before,
                    callIntrospectedProceduresOnly: false,
                });
                const result = await client.foo();
                assert.deepStrictEqual(result, {
                    success: false,
                    code: "OVERRIDE_CODE",
                    message: "'before' is throwing",
                    error: err,
                });
            });

            it("should preserve async_hooks context in 'before'", async () => {
                let called = [];
                const client = AllserverClient({
                    transport: VoidClientTransport(),
                    autoIntrospect: false,
                    before: [
                        (ctx, next) => {
                            setTraceIdAndRunFunction("my-random-trace-id", next);
                        },
                        () => {
                            assert.strictEqual(getTraceId(), "my-random-trace-id");
                            called.push(1);
                            return undefined;
                        },
                        () => {
                            assert.strictEqual(getTraceId(), "my-random-trace-id");
                            called.push(2);
                            return { success: false, code: "BAD_AUTH_OR_SOMETHING", message: "Bad auth or something" };
                        },
                        () => {
                            called.push(3);
                            assert.fail("should not be called");
                        },
                    ],
                });

                const result = await client.foo();

                assert.deepStrictEqual(result, {
                    success: false,
                    code: "BAD_AUTH_OR_SOMETHING",
                    message: "Bad auth or something",
                });
                assert.deepStrictEqual(called, [1, 2]);
            });
        });

        describe("'after'", () => {
            it("should call 'after'", async () => {
                let introspected = false;
                const MockedTransport = VoidClientTransport.methods({
                    async introspect(ctx) {
                        assert(ctx.isIntrospection);
                        introspected = true;
                        return {
                            success: true,
                            code: "OK",
                            message: "Ok",
                            procedures: JSON.stringify({ getRates: "function" }),
                        };
                    },
                    async call({ procedureName, arg }) {
                        assert.strictEqual(procedureName, "getRates");
                        assert.deepStrictEqual(arg, { a: 1, _: { procedureName: "getRates" } });
                        return { success: true, code: "CALLED", message: "A is good", b: 42 };
                    },
                });

                let afterCalled = 0;
                function after(ctx) {
                    assert.strictEqual(this, client, "The `this` context must be the client itself");
                    if (ctx.isIntrospection) {
                        assert(!ctx.procedureName);
                    } else {
                        assert.strictEqual(ctx.procedureName, "getRates");
                        assert.deepStrictEqual(ctx.arg, { a: 1, _: { procedureName: "getRates" } });
                        assert.deepStrictEqual(ctx.result, {
                            success: true,
                            code: "CALLED",
                            message: "A is good",
                            b: 42,
                        });
                    }
                    afterCalled += 1;
                }
                const client = AllserverClient({ transport: MockedTransport(), after });
                const result = await client.getRates({ a: 1 });
                assert.deepStrictEqual(result, { success: true, code: "CALLED", message: "A is good", b: 42 });
                assert.strictEqual(afterCalled, 2);
                assert(introspected);
            });

            it("should allow result override in 'after'", async () => {
                let defaultMiddlewareCalled = false;
                const DefaultedAllserverClient = AllserverClient.defaults({
                    after() {
                        defaultMiddlewareCalled = true;
                    },
                    callIntrospectedProceduresOnly: false,
                });
                const after = () => {
                    return "Override result";
                };
                const client = DefaultedAllserverClient({ transport: VoidClientTransport(), after });
                assert.strictEqual(client[p].after.length, 2, "Default middleware should be present");
                const result = await client.foo();
                assert.deepStrictEqual(result, "Override result");
                assert.ok(defaultMiddlewareCalled);
            });

            it("should handle rejections from 'after'", async () => {
                const err = new Error("'after' is throwing");
                const after = () => {
                    throw err;
                };
                const client = AllserverClient({
                    transport: VoidClientTransport(),
                    after,
                    callIntrospectedProceduresOnly: false,
                });
                const result = await client.foo();
                assert.deepStrictEqual(result, {
                    success: false,
                    code: "ALLSERVER_CLIENT_MIDDLEWARE_ERROR",
                    message: "The 'after' middleware error while calling 'foo' procedure: 'after' is throwing",
                    error: err,
                });
            });

            it("should override code if 'after' error has it", async () => {
                const err = new Error("'after' is throwing");
                err.code = "OVERRIDE_CODE";
                const after = () => {
                    throw err;
                };
                const client = AllserverClient({
                    transport: VoidClientTransport(),
                    after,
                    callIntrospectedProceduresOnly: false,
                });
                const result = await client.foo();
                assert.deepStrictEqual(result, {
                    success: false,
                    code: "OVERRIDE_CODE",
                    message: "'after' is throwing",
                    error: err,
                });
            });

            it("should preserve async_hooks context in 'after'", async () => {
                let called = [];
                const client = AllserverClient({
                    transport: VoidClientTransport(),
                    autoIntrospect: false,
                    before: [
                        (ctx, next) => {
                            setTraceIdAndRunFunction("my-random-trace-id", next);
                        },
                    ],
                    after: [
                        () => {
                            assert.strictEqual(getTraceId(), "my-random-trace-id");
                            called.push(1);
                        },
                        () => {
                            assert.strictEqual(getTraceId(), "my-random-trace-id");
                            called.push(2);
                        },
                    ],
                });

                await client.foo();

                assert.deepStrictEqual(called, [1, 2]);
            });
        });

        describe("'before'+'after'", () => {
            it("should call 'after' even if 'before' throws", async () => {
                let afterCalled = false;
                let secondBeforeCalled = false;
                let secondAfterCalled = false;
                const err = new Error("'before' is throwing");
                const client = AllserverClient({
                    callIntrospectedProceduresOnly: false,
                    transport: VoidClientTransport(),
                    before: [
                        () => {
                            throw err;
                        },
                        () => {
                            secondBeforeCalled = true;
                        },
                    ],
                    after: [
                        (ctx) => {
                            afterCalled = true;
                            return ctx.result;
                        },
                        () => {
                            secondAfterCalled = true;
                        },
                    ],
                });
                const result = await client.foo();
                assert(afterCalled);
                assert(!secondBeforeCalled);
                assert(!secondAfterCalled);
                assert.deepStrictEqual(result, {
                    success: false,
                    code: "ALLSERVER_CLIENT_MIDDLEWARE_ERROR",
                    message: "The 'before' middleware error while calling 'foo' procedure: 'before' is throwing",
                    error: err,
                });
            });
        });
    });

    describe("autoIntrospect", () => {
        it("should introspect and add methods before call", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                async call({ procedureName, arg }) {
                    assert.strictEqual(procedureName, "foo");
                    assert.deepStrictEqual(arg, { a: 1, _: { procedureName: "foo" } });
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            const client = AllserverClient({ transport: MockedTransport() });
            assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it yet
            const result = await client.foo({ a: 1 });
            assert.strictEqual(Reflect.has(client, "foo"), true); // have it now!
            assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
        });

        it("should attempt calling if introspection fails", async () => {
            const MockedTransport = VoidClientTransport.methods({
                introspect() {
                    return Promise.reject(new Error("Couldn't introspect"));
                },
                call({ procedureName, arg }) {
                    assert.strictEqual(procedureName, "foo");
                    assert.deepStrictEqual(arg, { a: 1, _: { procedureName: "foo" } });
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            const client = AllserverClient({ transport: MockedTransport(), callIntrospectedProceduresOnly: false });
            assert.strictEqual(Reflect.has(client, "foo"), false); // don't have it
            const result = await AllserverClient({
                transport: MockedTransport(),
                callIntrospectedProceduresOnly: false,
            }).foo({ a: 1 });
            assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
            assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
        });

        it("should not override existing methods", async () => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                async call() {
                    assert.fail("should not call transport");
                },
            });

            function foo(arg) {
                assert.strictEqual(arg && arg.a, 1);
                return {
                    success: true,
                    code: "CACHED",
                    message: "The reply mimics memory caching",
                    b: 2,
                };
            }

            const client = AllserverClient.methods({ foo }).create({ transport: MockedTransport() });
            assert.strictEqual(client.foo, foo);
            const result = await client.foo({ a: 1 });
            assert.strictEqual(client.foo, foo);
            assert.deepStrictEqual(result, {
                success: true,
                code: "CACHED",
                message: "The reply mimics memory caching",
                b: 2,
            });
        });

        it("should introspect same uri only once", async () => {
            let introspectionCalls = 0;
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    introspectionCalls += 1;
                    return {
                        success: true,
                        code: "OK",
                        message: "Ok",
                        procedures: JSON.stringify({ foo: "function" }),
                    };
                },
                async call() {
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            for (let i = 1; i <= 2; i += 1) {
                const client = AllserverClient({ transport: MockedTransport({ uri: "void://very-unique-address-1" }) });
                assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it yet
                const result = await client.foo({ a: 1 });
                assert.strictEqual(Reflect.has(client, "foo"), true); // have it now!
                assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
            }

            assert.strictEqual(introspectionCalls, 1);
        });

        it("should re-introspect failed introspections", async () => {
            let introspectionCalls = 0;
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    introspectionCalls += 1;
                    throw new Error("Shit happens twice");
                },
                async call() {
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            for (let i = 1; i <= 2; i += 1) {
                const client = AllserverClient({
                    transport: MockedTransport({ uri: "void://very-unique-address-2" }),
                    callIntrospectedProceduresOnly: false,
                });
                assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it
                const result = await client.foo({ a: 1 });
                assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
                assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
            }

            assert.strictEqual(introspectionCalls, 2);
        });

        it("should not auto introspect if asked so", (done) => {
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    done(new Error("Must not attempt introspection"));
                },
                async call() {
                    return { success: true, code: "CALLED_A", message: "A is good", b: 42 };
                },
            });

            const client = AllserverClient({
                autoIntrospect: false,
                transport: MockedTransport({ uri: "void://very-unique-address-3" }),
            });
            assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it
            client
                .foo({ a: 1 })
                .then((result) => {
                    assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
                    assert.deepStrictEqual(result, { success: true, code: "CALLED_A", message: "A is good", b: 42 });
                    done();
                })
                .catch(done);
        });

        it("should return original error if introspection fails", (done) => {
            const error = new Error("My error");
            const MockedTransport = VoidClientTransport.methods({
                async introspect() {
                    return { success: false, code: "SOME_ERROR", message: "My message", error };
                },
                async call() {
                    done(new Error("Must not attempt calling procedures"));
                },
            });

            const client = AllserverClient({
                transport: MockedTransport({ uri: "void://very-unique-address-3" }),
            });
            assert.strictEqual(Reflect.has(client, "foo"), false); // dont have it
            client
                .foo({ a: 1 })
                .then((result) => {
                    assert.strictEqual(Reflect.has(client, "foo"), false); // still don't have it
                    assert.deepStrictEqual(result, {
                        success: false,
                        code: "SOME_ERROR",
                        message: "My message",
                        error,
                    });
                    done();
                })
                .catch(done);
        });
    });

    describe("#defaults", () => {
        it("should work", () => {
            const NewClient = AllserverClient.defaults({
                neverThrow: false,
                dynamicMethods: false,
                autoIntrospect: false,
                nameMapper: (a) => a,
            });

            function protectedsAreOk(protecteds) {
                assert.strictEqual(protecteds.neverThrow, false);
                assert.strictEqual(protecteds.dynamicMethods, false);
                assert.strictEqual(protecteds.autoIntrospect, false);
                assert.strictEqual(typeof protecteds.nameMapper, "function");
            }

            protectedsAreOk(NewClient.compose.deepProperties[p]);
            protectedsAreOk(NewClient({ uri: "void://bla" })[p]);
        });

        it("should merge middlewares if supplied in the constructor too", () => {
            const before = () => {};
            const before2 = () => {};
            const after = () => {};
            const after2 = () => {};
            const NewClient = AllserverClient.defaults({
                neverThrow: false,
                dynamicMethods: false,
                autoIntrospect: false,
                nameMapper: (a) => a,
                before,
                after,
            });

            function protectedsAreOk(protecteds) {
                assert.strictEqual(protecteds.neverThrow, false);
                assert.strictEqual(protecteds.dynamicMethods, false);
                assert.strictEqual(protecteds.autoIntrospect, false);
                assert.strictEqual(typeof protecteds.nameMapper, "function");
                assert.deepStrictEqual(protecteds.before, [before, before2]);
                assert.deepStrictEqual(protecteds.after, [after, after2]);
            }

            protectedsAreOk(NewClient({ uri: "void://bla", before: before2, after: after2 })[p]);
        });

        it("should create new factory", () => {
            assert.notStrictEqual(AllserverClient, AllserverClient.defaults());
        });
    });
});
