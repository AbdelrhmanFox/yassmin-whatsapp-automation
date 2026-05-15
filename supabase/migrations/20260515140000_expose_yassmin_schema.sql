-- Expose yassmin schema to PostgREST / Supabase client
GRANT USAGE ON SCHEMA yassmin TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA yassmin TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA yassmin TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA yassmin TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA yassmin GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA yassmin GRANT ALL ON ROUTINES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA yassmin GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, yassmin';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
