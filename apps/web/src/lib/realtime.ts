/**
 * Realtime hook — joins the `v:<versionId>` Socket.io room and invokes
 * `onUpdate` whenever any room-scoped event fires. The actual payload
 * decides what to refetch in the caller.
 */
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

function ensureSocket(): Socket {
  if (socket) return socket;
  const url = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  // Realtime is on a sibling port — convention: API_URL_port + 1.
  const parsed = new URL(url);
  const wsPort = String(Number(parsed.port || 4000) + 1);
  parsed.port = wsPort;
  socket = io(parsed.toString(), { withCredentials: true, transports: ['websocket'] });
  return socket;
}

const EVENTS = ['comment:new', 'comment:resolved', 'comment:reopened', 'comment:deleted', 'approval:changed'];

export function useRealtime(versionId: string | null | undefined, onUpdate: () => void) {
  useEffect(() => {
    if (!versionId) return;
    const s = ensureSocket();
    s.emit('join:version', { versionId });
    const handler = () => onUpdate();
    for (const e of EVENTS) s.on(e, handler);
    return () => {
      for (const e of EVENTS) s.off(e, handler);
      s.emit('leave:version', { versionId });
    };
  }, [versionId, onUpdate]);
}
