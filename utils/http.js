const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
module.exports = { fail, wrap };
