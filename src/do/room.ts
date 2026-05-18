import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }
}
