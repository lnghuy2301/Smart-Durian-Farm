// Migration đã phát hành phải bất biến. Thay đổi schema tiếp theo bằng migration mới.
// Tên vật lý lowercase của PostgreSQL tương ứng 13 bảng nghiệp vụ trên ERD.
export const POSTGRES_SCHEMA_V1 = String.raw`
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE public.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_name varchar(40) NOT NULL,
 phone_number varchar(13) NOT NULL CHECK (phone_number ~ '^\+?[0-9]{9,13}$'),
 gmail varchar(255) UNIQUE CHECK (gmail IS NULL OR (gmail = lower(btrim(gmail)) AND gmail <> '')),
 password text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), is_owner boolean NOT NULL DEFAULT false,
 role text NOT NULL CHECK (role IN ('Farmer','Manager','Admin')),
 gmail_verify boolean NOT NULL DEFAULT false, status text NOT NULL CHECK (status IN ('Active','Locked','Pending','Reject')),
 CHECK (NOT gmail_verify OR gmail IS NOT NULL), CHECK (NOT is_owner OR role = 'Farmer')
);
CREATE UNIQUE INDEX users_phone_identity ON public.users
 ((CASE WHEN ltrim(phone_number,'+') ~ '^0[0-9]{9}$' THEN '84' || substr(ltrim(phone_number,'+'),2) ELSE ltrim(phone_number,'+') END));
CREATE TABLE public.cooperatives (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), manager_id uuid UNIQUE REFERENCES public.users(id),
 director varchar(40) NOT NULL, cooperative_name varchar(40) NOT NULL,
 certificate_number varchar(24) NOT NULL, address varchar(255) NOT NULL, contact_number varchar(14) NOT NULL
);
CREATE TABLE public.farming_standards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(40) NOT NULL, name varchar(100) NOT NULL,
 description text NOT NULL, certifying_body varchar(120) NOT NULL,
 status text NOT NULL CHECK (status IN ('Active','Inactive'))
);
CREATE TABLE public.agricultural_materials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL,
 material_type text NOT NULL CHECK (material_type IN ('Fertilizer','Pesticide','Biological')),
 default_dosage varchar(100) NOT NULL, unit varchar(10) NOT NULL,
 quarantine_days integer NOT NULL CHECK (quarantine_days >= 0),
 status text NOT NULL CHECK (status IN ('Active','Inactive'))
);
CREATE TABLE public.standard_materials (
 standard_id uuid NOT NULL REFERENCES public.farming_standards(id),
 material_id uuid NOT NULL REFERENCES public.agricultural_materials(id), PRIMARY KEY (standard_id,material_id)
);
CREATE TABLE public.farms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.users(id),
 cooperative_id uuid REFERENCES public.cooperatives(id), area_size numeric(7,3) NOT NULL CHECK (area_size > 0),
 address varchar(255) NOT NULL, certificate_number varchar(18) NOT NULL,
 join_cooperative_date timestamptz, longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
 CHECK ((cooperative_id IS NULL) = (join_cooperative_date IS NULL))
);
CREATE TABLE public.zones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), farm_id uuid NOT NULL REFERENCES public.farms(id),
 standard_id uuid NOT NULL REFERENCES public.farming_standards(id), zone_name varchar(255) NOT NULL,
 area_size numeric(7,3) NOT NULL CHECK (area_size > 0),
 longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90)
);
CREATE INDEX zones_farm ON public.zones(farm_id);
CREATE TABLE public.users_zones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 zone_id uuid NOT NULL REFERENCES public.zones(id), start_date timestamptz NOT NULL, end_date timestamptz,
 CHECK (end_date IS NULL OR end_date > start_date),
 EXCLUDE USING gist (zone_id WITH =, tstzrange(start_date,end_date,'[)') WITH &&)
);
CREATE INDEX users_zones_user ON public.users_zones(user_id);
CREATE TABLE public.trees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), zone_id uuid NOT NULL REFERENCES public.zones(id),
 tree_code varchar(100) NOT NULL UNIQUE, variety varchar(80) NOT NULL, plant_date timestamptz NOT NULL,
 longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
 status text NOT NULL CHECK (status IN ('Active','Removed','Dead'))
);
CREATE INDEX trees_zone ON public.trees(zone_id);
CREATE TABLE public.devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), zone_id uuid NOT NULL REFERENCES public.zones(id),
 station_id varchar(50) NOT NULL UNIQUE CHECK (station_id ~ '^[A-Za-z0-9_-]+$'),
 installed_at timestamptz NOT NULL, cost numeric(10,2) NOT NULL CHECK (cost >= 0),
 status text NOT NULL CHECK (status IN ('Active','Inactive','Maintenance')), last_seen_at timestamptz
);
CREATE INDEX devices_zone ON public.devices(zone_id);
CREATE TABLE public.sensors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES public.devices(id), name varchar(80) NOT NULL,
 sensor_type text NOT NULL CHECK (sensor_type IN ('air_temperature','air_humidity','soil_moisture')),
 data_stream_id varchar(50) NOT NULL CHECK (data_stream_id ~ '^[A-Za-z0-9_-]+$'), unit varchar(16) NOT NULL CHECK (length(btrim(unit)) > 0),
 min_threshold numeric(7,2), max_threshold numeric(7,2), status text NOT NULL CHECK (status IN ('Active','Inactive')),
 UNIQUE (device_id,data_stream_id),
 CHECK ((min_threshold IS NULL AND max_threshold IS NULL) OR (min_threshold IS NOT NULL AND max_threshold IS NOT NULL AND min_threshold < max_threshold))
);
CREATE TABLE public.actuators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES public.devices(id), name varchar(80) NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('shared','watering','spraying')),
 capability_id bigint NOT NULL CHECK (capability_id BETWEEN 1 AND 9007199254740991),
 status text NOT NULL CHECK (status IN ('Active','Inactive')), UNIQUE (device_id,capability_id)
);
CREATE TABLE public.tree_harvests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tree_id uuid NOT NULL REFERENCES public.trees(id),
 created_by uuid NOT NULL REFERENCES public.users(id), season_name varchar(50) NOT NULL, harvest_date date NOT NULL,
 fruit_count integer NOT NULL CHECK (fruit_count >= 0), total_weight_kg numeric(7,2) NOT NULL CHECK (total_weight_kg >= 0),
 batch_code varchar(50) NOT NULL, status text NOT NULL CHECK (status IN ('Draft','Pending','Confirmed')),
 updated_by uuid REFERENCES public.users(id), updated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tree_id,harvest_date), CHECK ((updated_by IS NULL) = (updated_at IS NULL))
);
CREATE INDEX harvests_batch ON public.tree_harvests(batch_code);
CREATE TABLE technical.entity_metadata (
 entity_type text NOT NULL, entity_key text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK (version >= 0),
 data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'), PRIMARY KEY (entity_type,entity_key)
);
CREATE UNIQUE INDEX metadata_seed_key ON technical.entity_metadata(entity_type,(data->>'seed_key')) WHERE data ? 'seed_key';
CREATE TABLE technical.workflow_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, action text NOT NULL, status text NOT NULL,
 target_key text, requested_by uuid NOT NULL REFERENCES public.users(id), expected_version bigint,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), created_at timestamptz NOT NULL,
 resolved_at timestamptz, resolved_by uuid REFERENCES public.users(id)
);
CREATE INDEX workflow_lookup ON technical.workflow_requests(module,status,target_key);
CREATE TABLE technical.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_key text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.users(id), action text NOT NULL, changed_at timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX audit_lookup ON technical.audit_events(entity_type,entity_key,changed_at,id);
CREATE TABLE technical.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid REFERENCES public.users(id),
 dedup_key text NOT NULL UNIQUE, type text NOT NULL, created_at timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX notification_recipient ON technical.notifications(recipient_id,created_at,id);

-- Chặn đổi định danh ở DB, kể cả khi một adapter sau này quên kiểm tra DTO.
CREATE FUNCTION technical.immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
 FOREACH field IN ARRAY TG_ARGV LOOP
  IF to_jsonb(NEW)->field IS DISTINCT FROM to_jsonb(OLD)->field THEN
   RAISE EXCEPTION 'immutable identity field' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER tree_identity BEFORE UPDATE ON public.trees FOR EACH ROW EXECUTE FUNCTION technical.immutable_fields('id','zone_id','tree_code');
CREATE TRIGGER zone_identity BEFORE UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION technical.immutable_fields('id','farm_id');
CREATE TRIGGER device_identity BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION technical.immutable_fields('id','zone_id','station_id');
CREATE TRIGGER sensor_identity BEFORE UPDATE ON public.sensors FOR EACH ROW EXECUTE FUNCTION technical.immutable_fields('id','device_id','data_stream_id','sensor_type');
CREATE TRIGGER actuator_identity BEFORE UPDATE ON public.actuators FOR EACH ROW EXECUTE FUNCTION technical.immutable_fields('id','device_id','capability_id','purpose');

-- Mọi ghi Zone khóa Farm cha; giảm diện tích Farm dùng cùng row lock.
-- Adapter dùng READ COMMITTED và khóa Farm trước câu ghi để không dùng snapshot cũ.
CREATE FUNCTION technical.zone_area_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed numeric; used numeric;
BEGIN
 SELECT area_size INTO allowed FROM public.farms WHERE id=NEW.farm_id FOR UPDATE;
 SELECT COALESCE(sum(area_size),0) INTO used FROM public.zones WHERE farm_id=NEW.farm_id AND id<>NEW.id;
 IF used + NEW.area_size > allowed THEN RAISE EXCEPTION 'zones exceed farm area' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zone_area BEFORE INSERT OR UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION technical.zone_area_guard();
CREATE FUNCTION technical.farm_area_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.area_size < (SELECT COALESCE(sum(area_size),0) FROM public.zones WHERE farm_id=NEW.id) THEN
  RAISE EXCEPTION 'farm area below zones' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER farm_area BEFORE UPDATE ON public.farms FOR EACH ROW EXECUTE FUNCTION technical.farm_area_guard();
CREATE FUNCTION technical.active_standard_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.standard_id IS DISTINCT FROM OLD.standard_id THEN
  IF NOT EXISTS (SELECT 1 FROM public.farming_standards WHERE id=NEW.standard_id AND status='Active') THEN
   RAISE EXCEPTION 'new standard must be active' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zone_standard BEFORE INSERT OR UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION technical.active_standard_guard();

-- Một batch không UNIQUE: khóa theo mã batch rồi kiểm tra mọi cây cùng Zone/ngày.
-- UPDATE khóa cả batch cũ/mới theo thứ tự cố định để tránh deadlock khi đổi mã.
CREATE FUNCTION technical.harvest_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_zone uuid; batch text;
BEGIN
 FOR batch IN SELECT DISTINCT x FROM unnest(ARRAY[NEW.batch_code,CASE WHEN TG_OP='UPDATE' THEN OLD.batch_code ELSE NEW.batch_code END]) x ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('harvest-batch:' || batch,0));
 END LOOP;
 SELECT zone_id INTO current_zone FROM public.trees WHERE id=NEW.tree_id;
 IF EXISTS (SELECT 1 FROM public.tree_harvests h JOIN public.trees t ON t.id=h.tree_id
  WHERE h.batch_code=NEW.batch_code AND h.id<>NEW.id AND (t.zone_id<>current_zone OR h.harvest_date<>NEW.harvest_date)) THEN
  RAISE EXCEPTION 'batch must share zone and harvest date' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER harvest_batch BEFORE INSERT OR UPDATE ON public.tree_harvests FOR EACH ROW EXECUTE FUNCTION technical.harvest_batch_guard();
CREATE FUNCTION technical.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit events are append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON technical.audit_events FOR EACH ROW EXECUTE FUNCTION technical.audit_immutable();
`;
