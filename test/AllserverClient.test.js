const assert = require("assert");

const VoidTransport = require("stampit")({
    methods: {
        introspect() {},
        call() {},
    },
});
const AllserverClient = require("..").AllserverClient.props({
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

        it("should call 'before' middleware", async () => {
            let beforeCalled = false;
            const server = Allserver({
                async before() {
                    beforeCalled = true;
                    return 42;
                },
            });

            const ctx = { void: { proc: "testMethod" } };
            await server.handleCall(ctx);

            assert(beforeCalled);
            assert.deepStrictEqual(ctx.result, 42);
        });

        it("should call 'after' middleware", async () => {
            let afterCalled = false;
            const server = Allserver({
                async after() {
                    afterCalled = true;
                    return 42;
                },
            });

            const ctx = { void: { proc: "testMethod" } };
            await server.handleCall(ctx);

            assert(afterCalled);
            assert.deepStrictEqual(ctx.result, 42);
        });

        it("should introspect", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                getProcedureName(ctx) {
                    assert.strictEqual(ctx.void.proc, "introspect");
                    return "";
                },
                prepareIntrospectionReply(ctx) {
                    ctx.result = {
                        success: true,
                        code: "OK",
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

        it("should reply PROCEDURE_NOT_FOUND", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                prepareNotFoundReply() {
                    ctx.result = {
                        success: false,
                        code: "PROCEDURE_NOT_FOUND",
                        message: `Procedure ${ctx.procedureName} not found`,
                    };
                },
                reply(ctx) {
                    assert.deepStrictEqual(ctx.result, {
                        success: false,
                        code: "PROCEDURE_NOT_FOUND",
                        message: "Procedure dontExist not found",
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

        it("should reply PROCEDURE_ERROR", async () => {
            let replied = false;
            const MockedTransport = VoidTransport.methods({
                prepareProcedureErrorReply(ctx) {
                    ctx.result = {
                        success: false,
                        code: ctx.error.code || "PROCEDURE_ERROR",
                        message: ctx.error.message,
                    };
                },
                reply(ctx) {
                    assert.deepStrictEqual(ctx.result, {
                        success: false,
                        code: "PROCEDURE_ERROR",
                        message: "'undefined' in not a function",
                    });
                    replied = true;
                },
            });
            let logged = false;
            const server = Allserver({
                logger: {
                    error(code, err) {
                        assert.strictEqual(code, "PROCEDURE_ERROR");
                        assert.strictEqual(err.message, "'undefined' in not a function");
                        logged = true;
                    },
                },
                procedures: {
                    async foo() {
                        throw new TypeError("'undefined' in not a function");
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
});
