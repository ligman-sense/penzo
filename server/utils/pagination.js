/**
 * Parse and validate pagination query params.
 * @param {object} query - Express req.query
 * @param {object} opts  - { defaultPageSize, maxPageSize }
 * @returns {{ page: number, pageSize: number, skip: number }}
 */
function parsePagination(query, opts = {}) {
  const { defaultPageSize = 20, maxPageSize = 100 } = opts;
  let page = parseInt(query.page, 10) || 1;
  let pageSize = parseInt(query.pageSize || query.limit, 10) || defaultPageSize;
  if (page < 1) page = 1;
  if (pageSize < 1) pageSize = defaultPageSize;
  if (pageSize > maxPageSize) pageSize = maxPageSize;
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}

module.exports = { parsePagination };
