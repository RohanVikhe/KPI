export function validate(part, schema) {
    return (req, _res, next) => {
        const result = schema.safeParse(req[part]);
        if (!result.success) {
            throw result.error;
        }
        req[part] = result.data;
        next();
    };
}
export const validateBody = (schema) => validate("body", schema);
export const validateParams = (schema) => validate("params", schema);
export const validateQuery = (schema) => validate("query", schema);
