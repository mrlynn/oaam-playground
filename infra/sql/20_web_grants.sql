-- The dashboard login (AIM_WEB) can read the views and nothing else.
GRANT SELECT ON aim_v_threads    TO aim_web
/
GRANT SELECT ON aim_v_messages   TO aim_web
/
GRANT SELECT ON aim_v_memories   TO aim_web
/
GRANT SELECT ON aim_v_store_info TO aim_web
/
