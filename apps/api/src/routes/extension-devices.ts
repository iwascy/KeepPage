import {
  extensionConnectInitRequestSchema,
  extensionConnectInitResponseSchema,
  extensionConnectRedeemRequestSchema,
  extensionDeviceListResponseSchema,
  extensionDeviceSessionSchema,
} from "@keeppage/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../services/auth/auth-service";
import type { ExtensionDeviceService } from "../services/auth/extension-device-service";

const extensionDeviceParamsSchema = z.object({
  deviceId: z.string().uuid(),
});

export async function registerExtensionDeviceRoutes(
  app: FastifyInstance,
  authService: AuthService,
  extensionDeviceService: ExtensionDeviceService,
) {
  app.post("/extension/connect", async (request, reply) => {
    const user = await authService.requireUser(request);
    const payload = extensionConnectInitRequestSchema.parse(request.body);
    const result = extensionDeviceService.createConnectCode(user.id, payload);
    return reply.status(201).send(extensionConnectInitResponseSchema.parse(result));
  });

  app.post("/extension/connect/redeem", async (request, reply) => {
    const payload = extensionConnectRedeemRequestSchema.parse(request.body);
    const result = await extensionDeviceService.redeemConnectCode(payload.code);
    return reply.send(extensionDeviceSessionSchema.parse(result));
  });

  app.get("/extension/devices", async (request, reply) => {
    const user = await authService.requireUser(request);
    const items = await extensionDeviceService.listDevices(user.id);
    return reply.send(extensionDeviceListResponseSchema.parse({ items }));
  });

  app.delete<{ Params: { deviceId: string } }>("/extension/devices/:deviceId", async (request, reply) => {
    const user = await authService.requireUser(request);
    const params = extensionDeviceParamsSchema.parse(request.params);
    const deleted = await extensionDeviceService.revokeDevice(user.id, params.deviceId);
    if (!deleted) {
      return reply.status(404).send({
        error: "ExtensionDeviceNotFound",
        message: "扩展设备不存在。",
      });
    }
    return reply.status(204).send();
  });
}
