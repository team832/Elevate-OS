import { created, defineRoute } from '@elevate/server-kit';
import { actorOf } from '../../../../server/route-helpers';
import { createRoomBody } from '../../../../server/schemas';
import { createRoom, listRooms } from '../../../../server';

export const dynamic = 'force-dynamic';

/** GET /academic/api/v1/rooms — Rooms. */
export const GET = defineRoute({ permission: 'academic:timetable:read' }, async (ctx) => listRooms(ctx.db));

/** POST /academic/api/v1/rooms — Create a room. */
export const POST = defineRoute({ permission: 'academic:timetable:write', body: createRoomBody }, async (ctx) => created(await createRoom(ctx.db, actorOf(ctx), ctx.body)));
