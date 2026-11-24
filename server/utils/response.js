function ok(res, data, meta, status = 200) {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

function created(res, data) {
  return ok(res, data, undefined, 201);
}

function pageMeta(page, pageSize, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { ok, created, pageMeta };
