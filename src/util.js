const is = (o, type) => typeof o === type;
module.exports = {
    isBoolean: (o) => is(o, "boolean"),
    isString: (o) => is(o, "string"),
    isFunction: (o) => is(o, "function"),
    isObject: (o) => is(o, "object"),
    isPlainObject: (o) => o && o.constructor === Object,
};
