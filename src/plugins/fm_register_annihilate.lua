local namespace = '{leverage::namespace}'
local fm_id = assert(KEYS[1], 'fm id is missing')

--
-- Delete all left over references to this fm server which are:
--
-- 1. the server in servers list
-- 2. the server keep-alive flag
-- 3. the server connection count
-- 4. the server details
--
redis.call('SREM', namespace .. 'fms', fm_id);
redis.call('DEL', namespace .. fm_id .. ':alive');
redis.call('DEL', namespace .. fm_id .. ':count');
redis.call('DEL', namespace .. 'fm:' .. fm_id);

return 1
