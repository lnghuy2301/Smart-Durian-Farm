import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
const { parser, generate } = createRequire(new URL("../../api/package.json", import.meta.url))("mqtt-packet");

// Chỉ fixture MQTT TCP trên loopback; điều khiển/ACK giả lập không ra phần cứng thật.
export async function loopbackBroker() {
  const sockets = new Set();
  const commands = [];
  let controlHandler;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    const decoder = parser({ protocolVersion: 4 });
    decoder.on("error", () => socket.destroy());
    decoder.on("packet", (packet) => {
      if (packet.cmd === "connect")
        socket.write(
          generate({ cmd: "connack", sessionPresent: false, returnCode: 0 }),
        );
      if (packet.cmd === "subscribe")
        socket.write(
          generate({
            cmd: "suback",
            messageId: packet.messageId,
            granted: [1],
          }),
        );
      if (packet.cmd === "pingreq") socket.write(generate({ cmd: "pingresp" }));
      if (
        packet.cmd === "publish" &&
        packet.topic.startsWith("subscribe/station/")
      ) {
        if (packet.qos === 1)
          socket.write(
            generate({ cmd: "puback", messageId: packet.messageId }),
          );
        const command = {
          station: packet.topic.split("/").at(-1),
          wire: JSON.parse(packet.payload.toString()),
        };
        commands.push(command);
        controlHandler?.(command);
      }
    });
    socket.on("data", (bytes) => decoder.parse(bytes));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    commands,
    onControl(handler) {
      controlHandler = handler;
    },
    ack(command, overrides = {}) {
      for (const socket of sockets)
        socket.write(
          generate({
            cmd: "publish",
            topic: `publish/station/${command.station}`,
            payload: JSON.stringify({
              taskId: command.wire.targets[0].taskId,
              status: "ACK",
              action: command.wire.taskingParameters.action,
              ...overrides,
            }),
            qos: 0,
            retain: false,
            dup: false,
          }),
        );
    },
    publish(station, records) {
      for (const socket of sockets)
        socket.write(
          generate({
            cmd: "publish",
            topic: `publish/station/${station}`,
            payload: JSON.stringify({
              stationId: station,
              sensorRecords: records,
            }),
            qos: 0,
            retain: false,
            dup: false,
          }),
        );
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
