const assert = require("assert");

const VoidTransport = require("stampit")({
    methods: {
        isIntrospection: () => false,
        getProcedureName: (ctx) => ctx.void.proc,
        prepareIntrospectionReply() {},
        prepareNotFoundReply() {},
        prepareProcedureErrorReply() {},
        reply() {},
    },
});
const Allserver = require("../..").Allserver.props({
    transport: VoidTransport(),
    procedures: { testMethod() {} },
});

describe("Allserver", () => {
    describe("#handleCall", () => {
        it("should count calls", () => {
            const server = Allserver();

            let ctx = { void: { proc: "testMethod" } };
            server.handleCall(ctx);
            assert.strictEqual(ctx.callNumber, 0);
            ctx = { void: { proc: "testMethod" } };
            server.handleCall(ctx);
            assert.strictEqual(ctx.callNumber, 1);
        });

        it("should call if procedures is an array", async () => {
            let called = false;
            const server = Allserver({
                procedures: [
                    () => {
                        called = true;
                        return 42;
                    },
                ],
            });

            let ctx = { void: { proc: "0" } };
            await server.handleCall(ctx);
            assert.strictEqual(called, true);
        });

        it("should reply ALLSERVER_PROCEDURE_NOT_FOUND", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                prepareNotFoundReply() {
                    ctx.result = {
                        success: false,
                        code: "ALLSERVER_PROCEDURE_NOT_FOUND",
                        message: `Procedure not found: ${ctx.procedureName}`,
                    };
                },
                reply(ctx) {
                    assert.deepStrictEqual(ctx.result, {
                        success: false,
                        code: "ALLSERVER_PROCEDURE_NOT_FOUND",
                        message: "Procedure not found: dontExist",
                    });
                    replied = true;
                },
            });
            const server = Allserver({
                procedures: { foo() {}, bar() {} },
                transport: MockedTransport(),
            });

            const ctx = { void: { proc: "dontExist" } };
            await server.handleCall(ctx);
            assert(replied);
        });

        it("should call the designated procedure", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                reply(ctx) {
                    assert.deepStrictEqual(ctx.result, {
                        success: true,
                        code: "OPENED",
                        message: "Bla",
                        data: "point",
                    });
                    replied = true;
                },
            });
            const server = Allserver({
                procedures: {
                    foo({ bar }) {
                        assert.strictEqual(bar, "baz");
                        return { success: true, code: "OPENED", message: "Bla", data: "point" };
                    },
                },
                transport: MockedTransport(),
            });

            const ctx = { void: { proc: "foo" }, arg: { bar: "baz" } };
            await server.handleCall(ctx);
            assert(replied);
        });

        it("should reply ALLSERVER_PROCEDURE_ERROR", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                reply(ctx) {
                    assert.deepStrictEqual(ctx.result, {
                        success: false,
                        code: "ALLSERVER_PROCEDURE_ERROR",
                        message: "''undefined' is not a function' error in 'foo' procedure",
                    });
                    replied = true;
                },
            });
            let logged = false;
            const server = Allserver({
                logger: {
                    error(code, err) {
                        assert.strictEqual(code, "ALLSERVER_PROCEDURE_ERROR");
                        assert.strictEqual(err.message, "'undefined' is not a function");
                        logged = true;
                    },
                },
                procedures: {
                    async foo() {
                        throw new TypeError("'undefined' is not a function");
                    },
                },
                transport: MockedTransport(),
            });

            await server.handleCall({ void: { proc: "foo" } });

            assert(replied);
            assert(logged);
        });

        it("should solidify returned object", async () => {
            const returns = [undefined, null, 0, "", {}, "Hui", []];

            for (const value of returns) {
                const server = Allserver({ procedures: { testMethod: () => value } });

                const ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert.strictEqual(typeof ctx.result, "object");
                assert.strictEqual(typeof ctx.result.success, "boolean");
                assert.strictEqual(typeof ctx.result.code, "string");
                assert.strictEqual(typeof ctx.result.message, "string");
            }
        });
    });

    describe("#start", () => {
        it("should call transport startServer()", async () => {
            let started = false;
            const MockedTransport = VoidTransport.methods({
                async startServer(...args) {
                    assert.strictEqual(args.length, 1);
                    assert.strictEqual(args[0].allserver, server);
                    started = true;
                },
            });

            const server = Allserver({ transport: MockedTransport() });
            const promise = server.start();

            assert(promise.then);
            await promise;
            assert(started);
        });
    });

    describe("#stop", () => {
        it("should call transport stopServer()", async () => {
            let stopped = false;
            const MockedTransport = VoidTransport.methods({
                async stopServer() {
                    stopped = true;
                },
            });

            const server = Allserver({ transport: MockedTransport() });
            const promise = server.stop();

            assert(promise.then);
            await promise;
            assert(stopped);
        });
    });

    describe("introspection", () => {
        it("should disable introspection", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                isIntrospection: () => true,
                async prepareIntrospectionReply(ctx) {
                    assert(!ctx.introspection);
                },
                async reply(ctx) {
                    assert.strictEqual(ctx.result, undefined);
                    replied = true;
                },
            });
            const server = Allserver({ introspection: false, transport: MockedTransport() });

            let ctx = { void: { proc: "" } };
            await server.handleCall(ctx);

            assert(replied);
        });

        it("should disable introspection via function", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                isIntrospection: () => true,
                async prepareIntrospectionReply(ctx) {
                    assert(!ctx.introspection);
                },
                async reply(ctx) {
                    assert.strictEqual(ctx.result, undefined);
                    replied = true;
                },
            });
            const server = Allserver({ introspection: () => false, transport: MockedTransport() });

            let ctx = { void: { proc: "" } };
            await server.handleCall(ctx);

            assert(replied);
        });

        it("should introspect", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                isIntrospection: () => true,
                getProcedureName(ctx) {
                    assert.strictEqual(ctx.void.proc, "introspect");
                    return "";
                },
                prepareIntrospectionReply(ctx) {
                    ctx.result = {
                        success: true,
                        code: "ALLSERVER_INTROSPECTION",
                        message: "Introspection as JSON string",
                        procedures: ctx.introspection,
                    };
                },
                reply(ctx) {
                    assert.deepStrictEqual(ctx.introspection, { foo: "function", bar: "function" });
                    replied = true;
                },
            });
            const server = Allserver({
                procedures: { foo() {}, bar() {} },
                transport: MockedTransport(),
            });

            const ctx = { void: { proc: "introspect" } };
            await server.handleCall(ctx);
            assert(replied);
        });
    });

    describe("middleware", () => {
        describe("'before'", () => {
            it("should call 'before'", async () => {
                let called = false;
                const server = Allserver({
                    before(ctx) {
                        assert.strictEqual(this, server, "The `this` context must be the server itself");
                        assert.deepStrictEqual(ctx, {
                            callNumber: 0,
                            procedure: server.procedures.testMethod,
                            procedureName: "testMethod",
                            isIntrospection: false,
                            void: {
                                proc: "testMethod",
                            },
                        });
                        called = true;
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert(called);
            });

            it("should handle exceptions from 'before'", async () => {
                let logged = false;
                const server = Allserver({
                    logger: {
                        error(code, err) {
                            assert.strictEqual(code, "ALLSERVER_MIDDLEWARE_ERROR");
                            assert.strictEqual(err.message, "Handle me please");
                            logged = true;
                        },
                    },
                    before() {
                        throw new Error("Handle me please");
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert(logged);
                assert.deepStrictEqual(ctx.result, {
                    success: false,
                    code: "ALLSERVER_MIDDLEWARE_ERROR",
                    message: "'Handle me please' error in 'before' middleware",
                });
            });

            it("should allow multiple 'before'", async () => {
                let called = [];
                const server = Allserver({
                    before: [
                        () => {
                            called.push(1);
                            return undefined;
                        },
                        () => {
                            called.push(2);
                            return { success: false, code: "BAD_AUTH_OR_SOMETHING", message: "Bad auth or something" };
                        },
                        () => {
                            called.push(3);
                            assert.fail("should not be called");
                        },
                    ],
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert.deepStrictEqual(called, [1, 2]);
                assert.deepStrictEqual(ctx.result, {
                    success: false,
                    code: "BAD_AUTH_OR_SOMETHING",
                    message: "Bad auth or something",
                });
            });

            it("should return 'before' result", async () => {
                let replied = false;
                const MockedTransport = VoidTransport.methods({
                    async reply(ctx) {
                        assert.strictEqual(ctx.result, 42);
                        replied = true;
                    },
                });
                const server = Allserver({
                    transport: MockedTransport(),
                    before() {
                        // There must be no result yet
                        assert(!ctx.result);
                        return 42;
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert(replied);
            });
        });

        describe("'after'", () => {
            it("should call 'after'", async () => {
                let called = false;
                const server = Allserver({
                    after(ctx) {
                        assert.strictEqual(this, server, "The `this` context must be the server itself");
                        assert.deepStrictEqual(ctx, {
                            callNumber: 0,
                            procedure: server.procedures.testMethod,
                            procedureName: "testMethod",
                            isIntrospection: false,
                            result: {
                                code: "SUCCESS",
                                message: "Success",
                                success: true,
                            },
                            void: {
                                proc: "testMethod",
                            },
                        });
                        called = true;
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert(called);
            });

            it("should handle exceptions from 'before'", async () => {
                let logged = false;
                const server = Allserver({
                    logger: {
                        error(code, err) {
                            assert.strictEqual(code, "ALLSERVER_MIDDLEWARE_ERROR");
                            assert.strictEqual(err.message, "Handle me please");
                            logged = true;
                        },
                    },
                    after() {
                        throw new Error("Handle me please");
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert(logged);
                assert.deepStrictEqual(ctx.result, {
                    success: false,
                    code: "ALLSERVER_MIDDLEWARE_ERROR",
                    message: "'Handle me please' error in 'after' middleware",
                });
            });

            it("should allow multiple 'after'", async () => {
                let called = [];
                const server = Allserver({
                    after: [
                        () => {
                            called.push(1);
                            return undefined;
                        },
                        () => {
                            called.push(2);
                            return { success: false, code: "OVERWRITING_RESULT", message: "Something something" };
                        },
                        () => {
                            called.push(3);
                            assert.fail("Should not be called");
                        },
                    ],
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert.deepStrictEqual(called, [1, 2]);
                assert.deepStrictEqual(ctx.result, {
                    success: false,
                    code: "OVERWRITING_RESULT",
                    message: "Something something",
                });
            });

            it("should return 'after' result", async () => {
                let replied = false;
                const MockedTransport = VoidTransport.methods({
                    async reply(ctx) {
                        assert.strictEqual(ctx.result, 42);
                        replied = true;
                    },
                });
                const server = Allserver({
                    transport: MockedTransport(),
                    after(ctx) {
                        // There already must be a result
                        assert(ctx.result);
                        return 42;
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert(replied);
            });
        });

        describe("'before'+'after'", () => {
            it("should call 'after' even if 'before' throws", async () => {
                let afterCalled = false;
                const err = new Error("Bad middleware");
                const server = Allserver({
                    logger: { error() {} },
                    before() {
                        throw err;
                    },
                    after() {
                        afterCalled = true;
                    },
                });

                let ctx = { void: { proc: "testMethod" } };
                await server.handleCall(ctx);

                assert.deepStrictEqual(ctx.result, {
                    success: false,
                    code: "ALLSERVER_MIDDLEWARE_ERROR",
                    message: "'Bad middleware' error in 'before' middleware",
                });
                assert.strictEqual(ctx.error, err);
                assert(afterCalled);
            });
        });
    });

    describe("init", () => {
        it("should init", () => {
            const server = require("../..").Allserver();

            // Creates HttpTransport by default
            assert(server.transport.micro);

            // Users console logger by default
            assert.strictEqual(server.logger, console);
        });
    });

    describe("defaults", () => {
        it("should work", () => {
            const procedures = {};
            const transport = VoidTransport();
            const logger = {};
            const introspection = false;
            const before = () => {};
            const after = () => {};

            const NewServer = Allserver.defaults({ procedures, transport, logger, introspection, before, after });

            function propsAreOk(props) {
                assert.strictEqual(props.procedures, procedures);
                assert.strictEqual(props.transport, transport);
                assert.strictEqual(props.logger, logger);
                assert.strictEqual(props.introspection, introspection);
                assert.strictEqual(props.before, before);
                assert.strictEqual(props.after, after);
            }

            propsAreOk(NewServer.compose.properties);
            propsAreOk(NewServer());
        });

        it("should create new factory", () => {
            assert.notStrictEqual(Allserver, Allserver.defaults());
        });
    });
});
