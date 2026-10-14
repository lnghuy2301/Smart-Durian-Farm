// Enum ứng dụng vẫn được CHECK ở PostgreSQL; không sửa migration001 đã Applied.
// Không đổi sensor_type của bất kỳ bản ghi cũ nào (identity trigger giữ nguyên).
export const SENSOR_TYPES_SCHEMA = String.raw`
ALTER TABLE public.sensors DROP CONSTRAINT sensors_sensor_type_check;
ALTER TABLE public.sensors ADD CONSTRAINT sensors_sensor_type_check CHECK
 (sensor_type IN ('air_temperature','air_humidity','soil_moisture','soil_temperature','soil_ph','soil_ec'));
`;
