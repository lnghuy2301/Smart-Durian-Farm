import { ForbiddenException, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MqttDiagnostics } from '../mqtt/mqtt-diagnostics';
import { MqttConfig } from '../mqtt/mqtt.config';
import { BrokerState, MqttTransport } from '../mqtt/mqtt.transport';
import { MQTT_DIAGNOSTIC_LIMIT, MessageDiagnostic, RoutedReading } from '../mqtt/mqtt.service';
import { MqttProtocolError, parseIncoming, stationFromTopic } from '../mqtt/mqtt.protocol';
import { DeviceRecords } from '../devices/device-records';
import { SensorRecords } from '../sensors/sensor-records';
import { TelemetryRecords } from '../telemetry/telemetry-records';
import { ActuatorTaskRecords } from '../actuator-tasks/actuator-task-records';
import { UserAccounts } from '../auth/user-accounts';
import { FarmPageDto } from '../farms/farms.dto';
import { farmInput, farmUuid } from '../farms/farm-validation';
import { PostgresTaskAccess } from './postgres-task-access';

// Transport diagnostics stay ephemeral/bounded. Device presence, measurements
// and receipts all use the SAME database ports as the private HTTP controllers.
export class DatabaseMqttService extends MqttDiagnostics implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseMqttService.name);
  private state: BrokerState;
  private readonly journal: MessageDiagnostic[] = [];
  private readonly pending = new Set<Promise<void>>();
  private closing = false;
  private counts = { telemetry: 0, ack: 0, unknown: 0, rejected: 0, accepted_readings: 0, rejected_readings: 0, unit_mismatches: 0 };
  constructor(private readonly config: MqttConfig, private readonly transport: MqttTransport,
    private readonly devices: DeviceRecords, private readonly sensors: SensorRecords, private readonly telemetry: TelemetryRecords,
    private readonly users: UserAccounts, private readonly tasks: ActuatorTaskRecords, private readonly access: PostgresTaskAccess) {
    super(); this.state = { enabled: config.enabled, connected: false, subscribed: false, last_error: null };
  }
  onModuleInit() {
    this.transport.start({ state: (state) => {
      this.state = { ...state };
      this.track(Promise.resolve(this.tasks.brokerChanged(state)).catch(() => this.logger.error('TASK_STATE_PERSISTENCE_FAILED')));
    }, message: (topic, payload, retained) => {
      if (this.closing) return;
      const receivedAt = new Date().toISOString();
      if (this.pending.size >= MQTT_DIAGNOSTIC_LIMIT) {
        ++this.counts.rejected;
        this.append({ received_at: receivedAt, device_id: null, kind: 'Rejected', reason: 'RECEIVER_BUSY', readings: [] }); return;
      }
      this.track(this.receive(topic, payload, retained, receivedAt));
    } });
  }
  async onModuleDestroy() { this.closing = true; await this.transport.stop(); await Promise.allSettled([...this.pending]); }
  async brokerStatus(actor: string) {
    const user = (await this.users.loadById(farmUuid(actor)))?.user;
    if (user?.status !== 'Active' || user.role !== 'Admin') throw new ForbiddenException('Chỉ Admin được xem chẩn đoán MQTT toàn hệ thống');
    return { ...this.state, ...this.counts, diagnostic_limit: MQTT_DIAGNOSTIC_LIMIT };
  }
  async deviceStatus(actor: string, device: string) {
    const record = await this.devices.get(actor, device), now = Date.now();
    const recent = record.last_seen_at !== null && now - Date.parse(record.last_seen_at) < this.config.offlineAfterMs;
    return { device_id: record.id, status: record.status, last_seen_at: record.last_seen_at,
      connectivity: record.last_seen_at === null ? 'Unknown' : recent ? 'Online' : 'Offline', broker_connected: this.state.connected,
      receiver_ready: this.state.subscribed, offline_after_ms: this.config.offlineAfterMs };
  }
  async messages(actor: string, device: string, input: FarmPageDto) {
    const page = farmInput(FarmPageDto, input); device = farmUuid(device);
    return this.access.read(actor, device, async (scope) => {
      // Diagnostics contain readings too: a new assignment must not disclose
      // packets from an older assignment, even though this buffer is only RAM.
      const items = this.journal.filter((item) => item.device_id === device && Date.parse(item.received_at) >= scope.from && Date.parse(item.received_at) < scope.to).reverse();
      return { items: structuredClone(items.slice(page.offset, page.offset + page.limit)), total: items.length, limit: page.limit, offset: page.offset };
    });
  }
  private async receive(topic: string, payload: Buffer, retained: boolean, receivedAt: string): Promise<void> {
    let deviceId: string | null = null;
    try {
      const station = stationFromTopic(topic);
      try { deviceId = (await this.devices.getRecordByStationId(station)).id; }
      catch (error) { if (error instanceof NotFoundException) throw new MqttProtocolError('UNREGISTERED_STATION'); throw error; }
      // Resolve registered Device for scoped diagnostics, but reject malformed
      // or retained packets before any presence/telemetry mutation.
      if (retained) throw new MqttProtocolError('RETAINED_MESSAGE');
      const incoming = parseIncoming(topic, payload);
      if (incoming.kind === 'Unknown') {
        ++this.counts.unknown; this.append({ received_at: receivedAt, device_id: deviceId, kind: 'Unknown', reason: 'UNSUPPORTED_MESSAGE', readings: [] }); return;
      }
      if (incoming.kind === 'Ack') {
        ++this.counts.ack;
        // Receipt correlation uses arrival time, before awaiting a presence write.
        // Persistence and task timers, never diagnostics, decide advancement.
        const reason = await this.tasks.receiveAck(deviceId, incoming.taskId, incoming.action, Date.parse(receivedAt));
        await this.devices.recordSeen(deviceId, receivedAt);
        this.append({ received_at: receivedAt, device_id: deviceId, kind: 'Ack', reason, readings: [], ack: { task_id: incoming.taskId, action: incoming.action } }); return;
      }
      await this.devices.recordSeen(deviceId, receivedAt);
      const device = await this.devices.getRecord(deviceId);
      const readings: RoutedReading[] = [];
      for (const reading of incoming.readings) {
        let sensor;
        try { sensor = await this.sensors.getRecordByStream(deviceId, reading.dataStreamId); }
        catch (error) { if (!(error instanceof NotFoundException)) throw error; }
        const reason = device.status !== 'Active' ? 'DEVICE_UNAVAILABLE' : !sensor ? 'UNMAPPED_STREAM' : sensor.status !== 'Active' ? 'SENSOR_UNAVAILABLE' : null;
        readings.push({ ...reading, sensor_id: sensor?.id ?? null, accepted: reason === null, reason, unit_mismatch: !!sensor && reading.receivedUnit !== sensor.unit });
      }
      // Adapter rechecks/locks metadata after these diagnostic lookups. A
      // concurrent deactivation cannot commit a stale reading into Mongo.
      await this.telemetry.record(deviceId, readings.filter((reading) => reading.accepted), receivedAt);
      ++this.counts.telemetry;
      for (const reading of readings) {
        if (reading.unit_mismatch) ++this.counts.unit_mismatches;
        if (reading.accepted) ++this.counts.accepted_readings; else ++this.counts.rejected_readings;
      }
      this.append({ received_at: receivedAt, device_id: deviceId, kind: 'Telemetry', reason: null, readings });
    } catch (error) {
      ++this.counts.rejected;
      this.append({ received_at: receivedAt, device_id: deviceId, kind: 'Rejected', reason: error instanceof MqttProtocolError ? error.message : 'RECEIVER_ERROR', readings: [] });
    }
  }
  private track(work: Promise<void>) {
    this.pending.add(work);
    void work.catch(() => this.logger.error('RECEIVER_ERROR')).finally(() => this.pending.delete(work));
  }
  private append(event: MessageDiagnostic) {
    if (this.journal.length === MQTT_DIAGNOSTIC_LIMIT) this.journal.shift();
    this.journal.push(event);
    if (event.reason || event.readings.some((reading) => reading.reason || reading.unit_mismatch)) this.logger.debug(event.reason ?? 'TELEMETRY_MAPPING_WARNING');
  }
}
